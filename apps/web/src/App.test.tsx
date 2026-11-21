import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import App from "./App";
import * as wallet from "./lib/wallet";

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

  it("replaces em dashes in wallet errors before showing them", async () => {
    const emDash = String.fromCharCode(0x2014);
    const connectWallet = vi.spyOn(wallet, "connectWallet").mockRejectedValue(
      new Error(`Soroban transport${emDash}rejected`),
    );

    try {
      render(<App />);
      fireEvent.click(screen.getByRole("button", { name: "Connect wallet" }));

      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toContain("Soroban transport; rejected");
      expect(alert.textContent).not.toContain(emDash);
    } finally {
      connectWallet.mockRestore();
    }
  });
});
