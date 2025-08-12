import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router";
import { OutletContextType } from "@/types/layout";
import {
  ArrowUpRight,
  ArrowDownLeft,
  Link as LinkIcon,
  Copy,
  ChevronLeft,
  ChevronRight,
  ArrowUp,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import { useNetwork } from "@/types/network";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ShowNotification } from "@/components/ShowNotification";

function txUrl(txHash: string, network: string) {
  return network === "mainnet"
    ? `https://cardanoscan.io/transaction/${txHash}`
    : `https://preprod.cardanoscan.io/transaction/${txHash}`;
}

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

export function History() {
  const { history } = useOutletContext<OutletContextType>();
  const { network } = useNetwork();

  const [message, setMessage] = useState<string | null>(null);
  const [pageSize, setPageSize] = useState<number>(10);
  const [page, setPage] = useState<number>(1);
  const [showTop, setShowTop] = useState<boolean>(false);

  const totalPages = Math.max(1, Math.ceil(history.length / pageSize));

  // Keep page in range when data or size changes
  useEffect(() => {
    setPage((p) => Math.min(Math.max(1, p), totalPages));
  }, [totalPages]);

  // Smooth "Top" button visibility
  useEffect(() => {
    const onScroll = () => setShowTop(window.scrollY > 200);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setMessage(`${text} has been copied`);
  };

  const paged = useMemo(() => {
    const start = (page - 1) * pageSize;
    return history.slice(start, start + pageSize);
  }, [history, page, pageSize]);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const onChangePageSize = (n: number) => {
    setPageSize(n);
    setPage(1); // reset to first page when size changes
    // optional: scroll to top for better UX
    scrollToTop();
  };

  const onChangePageNumber = () => {
    setPage((p) => Math.max(1, p - 1));
    scrollToTop();
  };

  const FooterControls = () => (
    <div className="mt-6 flex items-center justify-between gap-4 text-white mx-auto max-w-3xl">
      {/* Page size */}
      <div className="flex items-center gap-2">
        <label htmlFor="pageSize" className="text-sm opacity-80">
          Rows per page
        </label>
        <select
          id="pageSize"
          value={pageSize}
          onChange={(e) => onChangePageSize(Number(e.target.value))}
          className="rounded border bg-transparent px-2 py-1 text-sm focus:outline-none focus:ring text-black"
        >
          {PAGE_SIZE_OPTIONS.map((opt) => (
            <option key={opt} value={opt} className="bg-gray-900">
              {opt}
            </option>
          ))}
        </select>
      </div>

      {/* Paginator */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => {
            setPage(1);
            scrollToTop();
          }}
          disabled={page === 1}
          className="rounded border px-3 py-1 disabled:opacity-50 hover:scale-105 transition"
          aria-label="First page"
          title="First page"
        >
          <ChevronsLeft className="inline-block" />
        </button>
        <button
          type="button"
          onClick={() => onChangePageNumber()}
          disabled={page === 1}
          className="rounded border px-3 py-1 disabled:opacity-50 hover:scale-105 transition"
          aria-label="Previous page"
          title="Previous page"
        >
          <ChevronLeft className="inline-block" />
        </button>
        <span className="text-sm opacity-80">
          Page <span className="font-semibold">{page}</span> of{" "}
          <span className="font-semibold">{totalPages}</span>
        </span>
        <button
          type="button"
          onClick={() => onChangePageNumber()}
          disabled={page === totalPages}
          className="rounded border px-3 py-1 disabled:opacity-50 hover:scale-105 transition"
          aria-label="Next page"
          title="Next page"
        >
          <ChevronRight className="inline-block" />
        </button>
        <button
          type="button"
          onClick={() => {
            setPage(totalPages);
            scrollToTop();
          }}
          disabled={page === totalPages}
          className="rounded border px-3 py-1 disabled:opacity-50 hover:scale-105 transition"
          aria-label="Last page"
          title="Last page"
        >
          <ChevronsRight className="inline-block" />
        </button>
      </div>
    </div>
  );

  return (
    <div className="p-6 w-full">
      <h1 className="text-xl font-semibold text-center text-white">History</h1>

      <ShowNotification
        message={message}
        setMessage={setMessage}
        variant={"info"}
      />

      {history.length === 0 ? (
        <p className="text-white text-center mt-6">
          No Transactions Available.
        </p>
      ) : (
        <>
          {/* Top controls */}
          <FooterControls />

          <ul className="space-y-3 text-white w-full mx-auto max-w-3xl mt-4 max-[480px]:hidden">
            {paged.map((h) => (
              <li
                key={`${h.tx.tx_hash}-${h.side}`}
                className="mb-4 border rounded text-center p-4"
              >
                <span
                  className={`font-bold flex items-center gap-1 mb-4 justify-center ${h.side === "Input" ? "text-indigo-400" : "text-teal-400"}`}
                >
                  {h.side === "Input" ? <ArrowUpRight /> : <ArrowDownLeft />}
                  {h.side === "Input" ? "Sent Funds" : "Received Funds"}
                </span>
                <div className="gap-1 flex w-full min-w-0 justify-center">
                  <code className="pr-4 min-w-0 truncate">{h.tx.tx_hash}</code>
                  <button
                    type="button"
                    title={txUrl(h.tx.tx_hash, network)}
                    aria-label="Open on Cardanoscan"
                    onClick={() => openUrl(txUrl(h.tx.tx_hash, network))}
                    className="hover:scale-105 pr-4"
                  >
                    <LinkIcon />
                  </button>
                  <button
                    type="button"
                    title="Copy"
                    aria-label="Copy Transaction Id"
                    onClick={() => copy(h.tx.tx_hash)}
                    className="hover:scale-105"
                  >
                    <Copy />
                  </button>
                </div>
              </li>
            ))}
          </ul>

          {/* Bottom controls */}
          <FooterControls />
        </>
      )}

      {/* Floating Top button */}
      {showTop && (
        <button
          type="button"
          aria-label="Back to top"
          title="Back to top"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="fixed bottom-6 right-6 rounded-full p-3 border text-white bg-black/60 backdrop-blur hover:bg-black/80 transition"
        >
          <ArrowUp />
        </button>
      )}
    </div>
  );
}
