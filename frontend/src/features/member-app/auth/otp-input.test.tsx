import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { OtpInput } from "./otp-input";

function Harness({ onComplete }: { onComplete: (v: string) => void }) {
  const [value, setValue] = useState("");
  return <OtpInput value={value} onChange={setValue} onComplete={onComplete} />;
}

describe("OtpInput", () => {
  it("hanya digit, maksimal 6, onComplete saat penuh (tempel kode)", () => {
    const onComplete = vi.fn();
    render(<Harness onComplete={onComplete} />);
    const input = screen.getByLabelText("Kode verifikasi 6 digit") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "12a3" } });
    expect(input.value).toBe("123");
    expect(onComplete).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "123456789" } });
    expect(input.value).toBe("123456");
    expect(onComplete).toHaveBeenCalledWith("123456");
  });

  it("menampilkan digit di kotak", () => {
    render(<OtpInput value="42" onChange={() => {}} />);
    expect(screen.getByText("4")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
  });
});
