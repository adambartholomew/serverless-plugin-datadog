/*
 * Unless explicitly stated otherwise all files in this repository are licensed
 * under the Apache License Version 2.0.
 *
 * This product includes software developed at Datadog (https://www.datadoghq.com/).
 * Copyright 2019 Datadog, Inc.
 */
import fs from "fs";
import { FunctionDefinition } from "serverless";
import Service from "serverless/classes/Service";
import { getHandlerPath } from "./util";

export enum RuntimeType {
  NODE,
  NODE_TS,
  NODE_ES6,
  PYTHON,
  UNSUPPORTED,
}

export interface HandlerInfo {
  name: string;
  type: RuntimeType;
  handler: FunctionDefinition;
  runtime?: string;
}

export interface LayerJSON {
  regions: {
    [region: string]:
      | {
          [runtime: string]: string | undefined;
        }
      | undefined;
  };
}

export const runtimeLookup: { [key: string]: RuntimeType } = {
  "nodejs10.x": RuntimeType.NODE,
  "nodejs12.x": RuntimeType.NODE,
  "nodejs8.10": RuntimeType.NODE,
  "python2.7": RuntimeType.PYTHON,
  "python3.6": RuntimeType.PYTHON,
  "python3.7": RuntimeType.PYTHON,
  "python3.8": RuntimeType.PYTHON,
};

export function findHandlers(
  service: Service,
  defaultRuntime?: string,
  defaultNodeRuntime?: RuntimeType.NODE_ES6 | RuntimeType.NODE_TS | RuntimeType.NODE,
): HandlerInfo[] {
  const funcs = (service as any).functions as { [key: string]: FunctionDefinition };

  return Object.entries(funcs)
    .map(([name, handler]) => {
      let { runtime } = handler;
      if (runtime === undefined) {
        runtime = defaultRuntime;
      }
      if (runtime !== undefined && runtime in runtimeLookup) {
        const handlerInfo = { type: runtimeLookup[runtime], runtime, name, handler } as HandlerInfo;
        if (handlerInfo.type === RuntimeType.NODE) {
          const handlerPath = getHandlerPath(handlerInfo);
          if (handlerPath === undefined) {
            return;
          }

          if (defaultNodeRuntime === undefined) {
            if (
              fs.existsSync(`./${handlerPath.filename}.es.js`) ||
              fs.existsSync(`./${handlerPath.filename}.mjs`) ||
              hasWebpackPlugin(service)
            ) {
              handlerInfo.type = RuntimeType.NODE_ES6;
            }
            if (fs.existsSync(`./${handlerPath.filename}.ts`)) {
              handlerInfo.type = RuntimeType.NODE_TS;
            }
          } else {
            handlerInfo.type = defaultNodeRuntime;
          }
        }

        return handlerInfo;
      }
      return { type: RuntimeType.UNSUPPORTED, runtime, name, handler } as HandlerInfo;
    })
    .filter((result) => result !== undefined) as HandlerInfo[];
}

export function applyLayers(region: string, handlers: HandlerInfo[], layers: LayerJSON) {
  const regionRuntimes = layers.regions[region];
  if (regionRuntimes === undefined) {
    return;
  }

  for (const handler of handlers) {
    if (handler.type === RuntimeType.UNSUPPORTED) {
      continue;
    }

    const { runtime } = handler;
    const layerARN = runtime !== undefined ? regionRuntimes[runtime] : undefined;
    if (layerARN !== undefined) {
      const currentLayers = getLayers(handler);
      if (!new Set(currentLayers).has(layerARN)) {
        currentLayers.push(layerARN);
      }
      setLayers(handler, currentLayers);
    }
  }
}

function getLayers(handler: HandlerInfo) {
  const layersList = (handler.handler as any).layers as string[] | undefined;
  if (layersList === undefined) {
    return [];
  }
  return layersList;
}

function setLayers(handler: HandlerInfo, layers: string[]) {
  (handler.handler as any).layers = layers;
}

function hasWebpackPlugin(service: Service) {
  const plugins: string[] | undefined = (service as any).plugins;
  if (plugins === undefined) {
    return false;
  }
  return plugins.find((plugin) => plugin === "serverless-webpack") !== undefined;
}
