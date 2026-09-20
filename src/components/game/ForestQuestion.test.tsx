import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ForestQuestion, type ForestQuestionProps } from "./ForestQuestion";
import { forest } from "@/strings/forest";

const onAnswer = vi.fn();
const props: ForestQuestionProps = {
  question: { factKey: "comp10_3", skill: "comp10", operands: [3], format: "qcm", choices: [7, 6, 5, 3], isReask: false },
  draftKey: "test-question", paused: false, disabled: false, retrying: false, onAnswer,
};
let now = 0;
beforeEach(() => {
  localStorage.clear();
  onAnswer.mockClear();
  now = 0;
  vi.useFakeTimers();
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

it("answers choices by click and keyboard, and requests help without an invented answer", () => {
  render(<ForestQuestion {...props} />);
  expect(screen.getByRole("heading")).toHaveFocus();
  now = 125.7;
  fireEvent.click(screen.getByRole("button", { name: "7" }));
  expect(onAnswer).toHaveBeenLastCalledWith(7, 126);
  fireEvent.keyDown(document.body, { key: "2" });
  expect(onAnswer).toHaveBeenLastCalledWith(6, 126);
  fireEvent.click(screen.getByRole("button", { name: forest.help }));
  expect(onAnswer).toHaveBeenLastCalledWith(null, 126);
});
it("ignores shortcuts while paused, disabled, modified, repeated, or editing", () => {
  const view = render(<ForestQuestion {...props} />);
  for (const flags of [{ repeat: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }])
    fireEvent.keyDown(document.body, { key: "1", ...flags });
  for (const tag of ["input", "textarea", "div"]) {
    const element = document.createElement(tag);
    element.setAttribute("contenteditable", "true");
    document.body.append(element);
    fireEvent.keyDown(element, { key: "1" });
    element.remove();
  }
  fireEvent.keyDown(document.body, { key: "x" });
  view.rerender(<ForestQuestion {...props} paused />);
  fireEvent.keyDown(document.body, { key: "1" });
  view.rerender(<ForestQuestion {...props} disabled />);
  fireEvent.keyDown(document.body, { key: "1" });
  expect(onAnswer).not.toHaveBeenCalled();
});
it("does not invent absent QCM choices", () => {
  const view = render(<ForestQuestion {...props} question={{ ...props.question, choices: [7] }} />);
  fireEvent.keyDown(document.body, { key: "4" });
  view.rerender(<ForestQuestion {...props} question={{ ...props.question, choices: null }} />);
  fireEvent.keyDown(document.body, { key: "1" });
  expect(onAnswer).not.toHaveBeenCalled();
});
it("restores and edits a numeric draft, bounds its length, clears it and submits zero", () => {
  localStorage.setItem(props.draftKey, JSON.stringify({ digits: "12", elapsed: 350 }));
  const view = render(<ForestQuestion {...props} retrying question={{ ...props.question, format: "pave" }} />);
  const input = screen.getByRole("textbox", { name: forest.answerLabel });
  expect(input).toHaveFocus();
  expect(input).toHaveValue("12");
  expect(screen.getByText(forest.again)).toBeInTheDocument();
  fireEvent.change(input, { target: { value: "a123456" } });
  expect(input).toHaveValue("1234");
  fireEvent.click(screen.getByRole("button", { name: forest.backspace }));
  expect(input).toHaveValue("123");
  fireEvent.click(screen.getByRole("button", { name: forest.clear }));
  fireEvent.submit(view.container.querySelector("form")!);
  expect(onAnswer).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: forest.submit })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "0" }));
  now = 50;
  fireEvent.submit(view.container.querySelector("form")!);
  expect(onAnswer).toHaveBeenLastCalledWith(0, 400);
  expect(JSON.parse(localStorage.getItem(props.draftKey)!)).toEqual({ digits: "0", elapsed: 350 });
  view.rerender(<ForestQuestion {...props} paused question={{ ...props.question, format: "pave" }} />);
  fireEvent.submit(view.container.querySelector("form")!);
  expect(onAnswer).toHaveBeenCalledTimes(1);
});
it("counts only visible active time and persists elapsed time on pagehide and unmount", () => {
  const view = render(<ForestQuestion {...props} />);
  now = 1000;
  act(() => vi.advanceTimersByTime(1000));
  vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  now = 1500;
  fireEvent(document, new Event("visibilitychange"));
  now = 7000;
  fireEvent(window, new Event("pagehide"));
  expect(JSON.parse(localStorage.getItem(props.draftKey)!)).toEqual({ digits: "", elapsed: 1500 });
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  fireEvent(document, new Event("visibilitychange"));
  now = 7500;
  view.rerender(<ForestQuestion {...props} paused />);
  now = 9500;
  view.rerender(<ForestQuestion {...props} />);
  now = 10000;
  fireEvent.keyDown(document.body, { key: "1" });
  expect(onAnswer).toHaveBeenLastCalledWith(7, 2500);
  view.unmount();
  expect(JSON.parse(localStorage.getItem(props.draftKey)!).elapsed).toBe(2500);
});
it.each([-100, 90_000_000])("bounds persisted response time %s", (elapsed) => {
  localStorage.setItem(props.draftKey, JSON.stringify({ elapsed }));
  vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  render(<ForestQuestion {...props} />);
  fireEvent.keyDown(document.body, { key: "1" });
  expect(onAnswer).toHaveBeenCalledWith(7, elapsed < 0 ? 0 : 86_400_000);
});
it("keeps answering when local storage is malformed or unavailable", () => {
  localStorage.setItem(props.draftKey, "bad-json");
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("denied"); });
  render(<ForestQuestion {...props} question={{ ...props.question, format: "pave" }} />);
  fireEvent.click(screen.getByRole("button", { name: "7" }));
  fireEvent.click(screen.getByRole("button", { name: forest.submit }));
  expect(onAnswer).toHaveBeenCalledWith(7, 0);
});
