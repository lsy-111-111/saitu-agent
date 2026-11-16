import { describe, expect, it, vi, afterEach } from "vitest";
import { readSubmissionTimingV7, attachSubmissionTimingV7, assertSubmissionHasDetailBudgetV7, submissionModelDeadlineV7, SUBMISSION_TIMING_HEADER, SUBMISSION_ELAPSED_HEADER } from "../../../src/lib/competitions/v7/submission-timing";
afterEach(() => vi.useRealTimers());
describe("original submission timing", () => {
  it("carries the normalization anchor into a later recommendation and cannot reset it", () => {
    vi.useFakeTimers(); vi.setSystemTime(1_000_000);
    const first = new Request("http://localhost/normalize", { headers: { [SUBMISSION_ELAPSED_HEADER]: "250" } });
    expect(readSubmissionTimingV7(first).submittedAtEpochMs).toBe(999_750);
    const token = attachSubmissionTimingV7(first, new Response()).headers.get(SUBMISSION_TIMING_HEADER)!;
    vi.setSystemTime(1_020_000);
    const next = new Request("http://localhost/recommend", { headers: { [SUBMISSION_TIMING_HEADER]: token, [SUBMISSION_ELAPSED_HEADER]: "0" } });
    expect(readSubmissionTimingV7(next).submittedAtEpochMs).toBe(999_750);
    vi.setSystemTime(1_150_000);
    expect(() => assertSubmissionHasDetailBudgetV7(readSubmissionTimingV7(next))).toThrow("DECISION_TIMEOUT");
  });
  it("rejects forged timing and negative or nonnumeric elapsed values", () => {
    const invalidHeaders: Record<string, string>[] = [{ [SUBMISSION_TIMING_HEADER]: "abc.def" }, { [SUBMISSION_ELAPSED_HEADER]: "-5" }, { [SUBMISSION_ELAPSED_HEADER]: "NaN" }];
    for (const headers of invalidHeaders) expect(() => readSubmissionTimingV7(new Request("http://localhost", { headers }))).toThrow();
  });
  it("retains cached response timing and permits a genuine new operation to start anew", () => {
    vi.useFakeTimers(); vi.setSystemTime(1_000_000);
    const first = new Request("http://localhost/normalize");
    const response = attachSubmissionTimingV7(first, new Response());
    const token = response.headers.get(SUBMISSION_TIMING_HEADER);
    vi.setSystemTime(1_020_000);
    const retry = new Request("http://localhost/normalize");
    expect(attachSubmissionTimingV7(retry, response).headers.get(SUBMISSION_TIMING_HEADER)).toBe(token);
    expect(readSubmissionTimingV7(new Request("http://localhost/retry")).submittedAtEpochMs).toBe(1_020_000);
  });
  it("uses the original click for the new 60/150 second hard cutoffs while targets do not cancel work",()=>{
    vi.useFakeTimers();vi.setSystemTime(1_045_000);
    const request=new Request("http://localhost/normalize",{headers:{[SUBMISSION_ELAPSED_HEADER]:"45000"}});
    expect(submissionModelDeadlineV7(request,2_000_000,"before_rank")).toBe(1_060_000);
    vi.setSystemTime(1_125_000);
    expect(()=>assertSubmissionHasDetailBudgetV7(readSubmissionTimingV7(request))).not.toThrow();
    expect(submissionModelDeadlineV7(request,2_000_000,"chat")).toBe(1_150_000);
    expect(()=>submissionModelDeadlineV7(request,2_000_000,"before_rank")).toThrow("DECISION_TIMEOUT");
    vi.setSystemTime(1_150_000);
    expect(()=>assertSubmissionHasDetailBudgetV7(readSubmissionTimingV7(request))).toThrow("DECISION_TIMEOUT");
  });
});
