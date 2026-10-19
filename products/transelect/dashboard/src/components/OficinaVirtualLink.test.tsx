import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OficinaVirtualLink } from "./OficinaVirtualLink";

describe("OficinaVirtualLink keyboard and click isolation", () => {
  it("keeps Enter and Space from reaching a clickable row, but lets other keys through", () => {
    const onRowKey = vi.fn();
    const onRowClick = vi.fn();
    render(
      <div onKeyDown={onRowKey} onClick={onRowClick}>
        <OficinaVirtualLink numero="ING-7" compact withLink />
      </div>,
    );
    const link = screen.getByTestId("oficina-virtual-link");

    fireEvent.keyDown(link, { key: "Enter" });
    fireEvent.keyDown(link, { key: " " });
    expect(onRowKey).not.toHaveBeenCalled();

    fireEvent.keyDown(link, { key: "Tab" });
    fireEvent.keyDown(link, { key: "Escape" });
    expect(onRowKey).toHaveBeenCalledTimes(2);

    fireEvent.click(link);
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("opens CONAF's result for a plain N.º, with the number already entered", () => {
    render(<OficinaVirtualLink numero=" 123456 " withLink />);
    expect(screen.getByTestId("oficina-virtual-link")).toHaveAttribute(
      "href",
      "https://oficinavirtual.conaf.cl/consultas/action.php?nsolicitud=123456",
    );
  });

  it("opens CONAF's result for the planilla's slashed N.º, the most recent of a pair", () => {
    // FACT (2026-10-18): CONAF answers 12/345-6/24 by link, slashes encoded.
    render(<OficinaVirtualLink numero="39/345-6/24 11/345-6/26" withLink />);
    expect(screen.getByTestId("oficina-virtual-link")).toHaveAttribute(
      "href",
      "https://oficinavirtual.conaf.cl/consultas/action.php?nsolicitud=11%2F345-6%2F26",
    );
  });

  it("opens the empty consulta page for a mistyped N.º", () => {
    render(<OficinaVirtualLink numero="16/345-10-25" withLink />);
    expect(screen.getByTestId("oficina-virtual-link")).toHaveAttribute(
      "href",
      "https://oficinavirtual.conaf.cl/consultas/index.php",
    );
    expect(screen.getByTestId("oficina-virtual-copy")).toBeInTheDocument();
  });

  it("opens CONAF's empty consulta page without an N.º", () => {
    render(<OficinaVirtualLink numero={null} withLink />);
    expect(screen.getByTestId("oficina-virtual-link")).toHaveAttribute(
      "href",
      "https://oficinavirtual.conaf.cl/consultas/index.php",
    );
  });

  it("offers no copy button without an N.º", () => {
    render(<OficinaVirtualLink numero={null} />);
    expect(screen.queryByTestId("oficina-virtual-copy")).toBeNull();
  });

  it("can leave out the link and keep «Copiar N.º»", () => {
    render(<OficinaVirtualLink numero="10099992" withLink={false} />);
    expect(screen.queryByTestId("oficina-virtual-link")).toBeNull();
    expect(screen.getByTestId("oficina-virtual-copy")).toHaveAccessibleName("Copiar N.º 10099992");
  });
});
