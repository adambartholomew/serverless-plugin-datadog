/*
 * Unless explicitly stated otherwise all files in this repository are licensed
 * under the Apache License Version 2.0.
 *
 * This product includes software developed at Datadog (https://www.datadoghq.com/).
 * Copyright 2019 Datadog, Inc.
 */

import { HandlerInfo, LayerJSON, RuntimeType, applyLayers, findHandlers } from "./layer";

import { FunctionDefinition } from "serverless";
import Service from "serverless/classes/Service";
import fs from "fs";
import mock from "mock-fs";

function createMockService(
  region: string,
  funcs: { [funcName: string]: Partial<FunctionDefinition> },
  plugins?: string[],
): Service {
  const service: Partial<Service> & { functions: any; plugins: any } = {
    provider: { region } as any,
    getAllFunctionsNames: () => Object.keys(funcs),
    getFunction: (name) => funcs[name] as FunctionDefinition,
    functions: funcs as any,
    plugins,
  };
  return service as Service;
}

describe("findHandlers", () => {
  it("finds all node and python layers with matching layers", () => {
    const mockService = createMockService("us-east-1", {
      "func-a": { handler: "myfile.handler", runtime: "nodejs8.10" },
      "func-b": { handler: "myfile.handler", runtime: "go1.10" },
      "func-c": { handler: "myfile.handler", runtime: "nodejs10.x" },
      "func-d": { handler: "myfile.handler", runtime: "python2.7" },
      "func-e": { handler: "myfile.handler", runtime: "python3.6" },
      "func-f": { handler: "myfile.handler", runtime: "python3.7" },
      "func-g": { handler: "myfile.handler", runtime: "python3.8" },
      "func-h": { handler: "myfile.handler", runtime: "nodejs12.x" },
    });

    const result = findHandlers(mockService);
    expect(result).toMatchObject([
      {
        handler: { handler: "myfile.handler", runtime: "nodejs8.10" },
        type: RuntimeType.NODE,
        runtime: "nodejs8.10",
      },
      {
        handler: { handler: "myfile.handler", runtime: "go1.10" },
        type: RuntimeType.UNSUPPORTED,
        runtime: "go1.10",
      },
      {
        handler: { handler: "myfile.handler", runtime: "nodejs10.x" },
        type: RuntimeType.NODE,
        runtime: "nodejs10.x",
      },
      {
        handler: { handler: "myfile.handler", runtime: "python2.7" },
        type: RuntimeType.PYTHON,
        runtime: "python2.7",
      },
      {
        handler: { handler: "myfile.handler", runtime: "python3.6" },
        type: RuntimeType.PYTHON,
        runtime: "python3.6",
      },
      {
        handler: { handler: "myfile.handler", runtime: "python3.7" },
        type: RuntimeType.PYTHON,
        runtime: "python3.7",
      },
      {
        handler: { handler: "myfile.handler", runtime: "python3.8" },
        type: RuntimeType.PYTHON,
        runtime: "python3.8",
      },
      {
        handler: { runtime: "nodejs12.x" },
        type: RuntimeType.NODE,
        runtime: "nodejs12.x",
      },
    ]);
  });
  it("uses the global runtime when one isn't specified", () => {
    const mockService = createMockService("us-east-1", {
      "func-a": { handler: "myfile.handler" },
    });
    const result = findHandlers(mockService, "nodejs8.10");
    expect(result).toMatchObject([
      {
        handler: {},
        type: RuntimeType.NODE,
        runtime: "nodejs8.10",
      },
    ]);
  });

  it("uses typescript runtime when ts file is detected", () => {
    mock({
      "mylambda.ts": "",
    });
    const mockService = createMockService("us-east-1", {
      "func-a": { handler: "mylambda.handler", runtime: "nodejs8.10" },
    });
    const result = findHandlers(mockService, "nodejs8.10");

    expect(result).toMatchObject([
      {
        handler: { handler: "mylambda.handler", runtime: "nodejs8.10" },
        type: RuntimeType.NODE_TS,
        runtime: "nodejs8.10",
      },
    ]);
  });
  it("uses es6 runtime when es.js file is detected", () => {
    mock({
      "mylambda.es.js": "",
    });
    const mockService = createMockService("us-east-1", {
      "func-a": { handler: "mylambda.handler", runtime: "nodejs8.10" },
    });
    const result = findHandlers(mockService, "nodejs8.10");

    expect(result).toMatchObject([
      {
        handler: { handler: "mylambda.handler", runtime: "nodejs8.10" },
        type: RuntimeType.NODE_ES6,
        runtime: "nodejs8.10",
      },
    ]);
  });
  it("uses es6 runtime when .mjs file is detected", () => {
    mock({
      "mylambda.mjs": "",
    });
    const mockService = createMockService("us-east-1", {
      "func-a": { handler: "mylambda.handler", runtime: "nodejs8.10" },
    });
    const result = findHandlers(mockService, "nodejs8.10");

    expect(result).toMatchObject([
      {
        handler: { handler: "mylambda.handler", runtime: "nodejs8.10" },
        type: RuntimeType.NODE_ES6,
        runtime: "nodejs8.10",
      },
    ]);
  });
  it("uses default node runtime when provided", () => {
    mock({
      "mylambda.js": "",
    });
    const mockService = createMockService("us-east-1", {
      "func-a": { handler: "mylambda.handler", runtime: "nodejs8.10" },
    });
    const result = findHandlers(mockService, "nodejs8.10", RuntimeType.NODE_TS);

    expect(result).toMatchObject([
      {
        handler: { handler: "mylambda.handler", runtime: "nodejs8.10" },
        type: RuntimeType.NODE_TS,
        runtime: "nodejs8.10",
      },
    ]);
  });
  it("uses es6 runtime by default when webpack detected", () => {
    mock({
      "mylambda.js": "",
    });
    const plugins = ["serverless-plugin-datadog", "serverless-webpack"];
    const mockService = createMockService(
      "us-east-1",
      {
        "func-a": { handler: "mylambda.handler", runtime: "nodejs8.10" },
      },
      plugins,
    );
    const result = findHandlers(mockService, "nodejs8.10");

    expect(result).toMatchObject([
      {
        handler: { handler: "mylambda.handler", runtime: "nodejs8.10" },
        type: RuntimeType.NODE_ES6,
        runtime: "nodejs8.10",
      },
    ]);
  });
});

describe("applyLayers", () => {
  it("adds a layer array if none are present", () => {
    const handler = {
      handler: { runtime: "nodejs10.x" },
      type: RuntimeType.NODE,
      runtime: "nodejs10.x",
    } as HandlerInfo;
    const layers: LayerJSON = {
      regions: { "us-east-1": { "nodejs10.x": "node:2" } },
    };
    applyLayers("us-east-1", [handler], layers);
    expect(handler.handler).toEqual({
      runtime: "nodejs10.x",
      layers: ["node:2"],
    });
  });
  it("appends to the layer array if already present", () => {
    const handler = {
      handler: { runtime: "nodejs10.x", layers: ["node:1"] } as any,
      type: RuntimeType.NODE,
      runtime: "nodejs10.x",
    } as HandlerInfo;
    const layers: LayerJSON = {
      regions: { "us-east-1": { "nodejs10.x": "node:2" } },
    };
    applyLayers("us-east-1", [handler], layers);
    expect(handler.handler).toEqual({
      runtime: "nodejs10.x",
      layers: ["node:1", "node:2"],
    });
  });
  it("doesn't add duplicate layers", () => {
    const handler = {
      handler: { runtime: "nodejs10.x", layers: ["node:1"] } as any,
      type: RuntimeType.NODE,
      runtime: "nodejs10.x",
    } as HandlerInfo;
    const layers: LayerJSON = {
      regions: { "us-east-1": { "nodejs10.x": "node:1" } },
    };
    applyLayers("us-east-1", [handler], layers);
    expect(handler.handler).toEqual({
      runtime: "nodejs10.x",
      layers: ["node:1"],
    });
  });
  it("only adds layer when region can be found", () => {
    const handler = {
      handler: { runtime: "nodejs10.x" } as any,
      type: RuntimeType.NODE,
      runtime: "nodejs10.x",
    } as HandlerInfo;
    const layers: LayerJSON = {
      regions: { "us-east-1": { "nodejs10.x": "node:1" } },
    };
    applyLayers("us-east-2", [handler], layers);
    expect(handler.handler).toEqual({
      runtime: "nodejs10.x",
    });
  });
  it("only adds layer when layer ARN can be found", () => {
    const handler = {
      handler: { runtime: "nodejs10.x" } as any,
      type: RuntimeType.NODE,
      runtime: "nodejs10.x",
    } as HandlerInfo;
    const layers: LayerJSON = {
      regions: { "us-east-1": { "python2.7": "python:2" } },
    };
    applyLayers("us-east-1", [handler], layers);
    expect(handler.handler).toEqual({
      runtime: "nodejs10.x",
    });
  });
  it("only adds layer when runtime present", () => {
    const handler = {
      handler: {} as any,
      type: RuntimeType.NODE,
      runtime: "nodejs10.x",
    } as HandlerInfo;
    const layers: LayerJSON = {
      regions: { "us-east-1": { "python2.7": "python:2" } },
    };
    applyLayers("us-east-1", [handler], layers);
    expect(handler.handler).toEqual({});
  });
  it("only add layer when when supported runtime present", () => {
    const handler = {
      handler: {} as any,
      type: RuntimeType.UNSUPPORTED,
    } as HandlerInfo;
    const layers: LayerJSON = {
      regions: { "us-east-1": { "python2.7": "python:2" } },
    };
    applyLayers("us-east-1", [handler], layers);
    expect(handler.handler).toEqual({});
  });
});
