import { describe, expect, it } from "vitest";
import {
  describeOtpError,
  describeSendError,
  isCompleteOtpCode,
  normalizeOtpCode,
  OTP_MISMATCH,
  safeNext,
} from "./auth-otp";

describe("normalizeOtpCode", () => {
  it("keeps only digits and caps at six", () => {
    expect(normalizeOtpCode("123 456")).toBe("123456");
    expect(normalizeOtpCode("123-456")).toBe("123456");
    expect(normalizeOtpCode("Your code is 123456.")).toBe("123456");
    expect(normalizeOtpCode("1234567")).toBe("123456");
    expect(normalizeOtpCode("12")).toBe("12");
    expect(normalizeOtpCode("")).toBe("");
  });

  it("knows when a code is complete", () => {
    expect(isCompleteOtpCode("123456")).toBe(true);
    expect(isCompleteOtpCode("12345")).toBe(false);
    expect(isCompleteOtpCode("12345a")).toBe(false);
  });
});

describe("safeNext", () => {
  it("allows same-origin paths only", () => {
    expect(safeNext("/app/new")).toBe("/app/new");
    expect(safeNext("/join/abc/complete")).toBe("/join/abc/complete");
    expect(safeNext("//evil.example")).toBe("/");
    expect(safeNext("/\\evil.example")).toBe("/");
    expect(safeNext("https://evil.example")).toBe("/");
    expect(safeNext("")).toBe("/");
    expect(safeNext(null)).toBe("/");
    expect(safeNext(undefined)).toBe("/");
  });
});

describe("describeOtpError", () => {
  it("reads the same for a wrong and an expired code", () => {
    expect(describeOtpError("otp_expired")).toBe(OTP_MISMATCH);
    expect(describeOtpError("invalid_credentials")).toBe(OTP_MISMATCH);
    expect(OTP_MISMATCH).toBe("That code didn't match. Check the newest email or send a new code.");
  });

  it("names the rate limit", () => {
    expect(describeOtpError("over_request_rate_limit")).toContain("Wait a minute");
  });

  it("has a fallback that says what to do", () => {
    expect(describeOtpError(undefined)).toBe("Couldn't check that code. Send a new code and try again.");
  });
});

describe("describeSendError", () => {
  it("covers the send-side failures", () => {
    expect(describeSendError("over_email_send_rate_limit")).toContain("Too many codes");
    expect(describeSendError("email_address_invalid")).toContain("doesn't look right");
    expect(describeSendError("signup_disabled")).toContain("invite link");
    expect(describeSendError(undefined)).toBe("Couldn't send the code. Check the email address and try again.");
  });
});
