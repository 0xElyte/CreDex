"use client";
import { useEffect } from "react";
import { Provider, useDispatch } from "react-redux";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { store } from "@/store";
import { tickYield } from "@/store/financeSlice";

// Ticks yield every 5 seconds for any connected session
function YieldTicker() {
  const dispatch = useDispatch();
  useEffect(() => {
    // Tick immediately then every 5s
    dispatch(tickYield());
    const interval = setInterval(() => dispatch(tickYield()), 5_000);
    return () => clearInterval(interval);
  }, [dispatch]);
  return null;
}

function InnerProviders({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            refetchOnWindowFocus: false,
            // Prevent hydration errors from SSR
            staleTime: 0,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <YieldTicker />
      {children}
    </QueryClientProvider>
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <Provider store={store}>
      <InnerProviders>{children}</InnerProviders>
    </Provider>
  );
}
