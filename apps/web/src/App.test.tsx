import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "./App";

describe("dashboard interface copy", () => {
  it("uses direct labels and contains no em dashes", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "Check a document." })).toBeTruthy();
    expect(screen.getByText("No transactions yet")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /view all/i })).toBeNull();
    expect(document.body.textContent).not.toContain(String.fromCharCode(0x2014));
  });

  it("states which workspace features are available", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "What is available" })).toBeTruthy();
    expect(screen.getByText(/No recovery flow is available yet/)).toBeTruthy();
  });
});
