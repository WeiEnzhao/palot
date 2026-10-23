import { describe, expect, it } from "vitest";
import { localizeErrorText } from "./error-text";

describe("localizeErrorText", () => {
  it("翻译模型不可用，并原样保留型号名", () => {
    expect(localizeErrorText("Model unavailable: opencode/minimax-m3.1-flash-free")).toBe(
      "模型不可用：opencode/minimax-m3.1-flash-free",
    );
  });

  it("翻译国家级不可用提示", () => {
    expect(localizeErrorText("This model is not available in your country")).toBe(
      "该模型在你所在的国家或地区不可用",
    );
  });

  it("翻译限速与超时", () => {
    expect(localizeErrorText("Rate limited")).toBe("请求被限速，请稍后再试");
    expect(localizeErrorText("request timed out")).toBe("请求超时");
  });

  it("翻译鉴权与额度类错误", () => {
    expect(localizeErrorText("Unauthorized")).toBe("未授权：请检查账号或密钥");
    expect(localizeErrorText("insufficient quota")).toBe("额度不足");
    expect(localizeErrorText("Invalid API key")).toBe("API 密钥无效");
  });

  it("翻译上下文超限与网络失败", () => {
    expect(localizeErrorText("context length exceeded")).toBe("上下文长度超出模型上限");
    expect(localizeErrorText("Network error")).toBe("网络连接失败");
  });

  it("识别不了的文案原样返回，绝不丢信息", () => {
    const raw = "Tool ABC crashed while parsing /tmp/x.json";
    expect(localizeErrorText(raw)).toBe(raw);
  });

  it("空值与空白返回 undefined", () => {
    expect(localizeErrorText(null)).toBeUndefined();
    expect(localizeErrorText(undefined)).toBeUndefined();
    expect(localizeErrorText("   ")).toBeUndefined();
  });
});
