"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAppSelector } from "@/store/hooks";

/**
 * Redirects to /app if wallet is not connected.
 * Use at the top of any protected page.
 */
export function useWalletGuard() {
  const router = useRouter();
  const status = useAppSelector((s) => s.wallet.status);

  useEffect(() => {
    if (status === "disconnected") {
      router.replace("/app");
    }
  }, [status, router]);

  return status;
}
