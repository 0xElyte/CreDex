import { useCallback } from "react";
import { useAppDispatch } from "@/store/hooks";
import { addToast, removeToast, dismissLoading } from "@/store/toastSlice";

export function useToast() {
  const dispatch = useAppDispatch();

  const success = useCallback(
    (title: string, message?: string) =>
      dispatch(addToast({ type: "success", title, message })),
    [dispatch]
  );

  const error = useCallback(
    (title: string, message?: string) =>
      dispatch(addToast({ type: "error", title, message, duration: 6000 })),
    [dispatch]
  );

  const info = useCallback(
    (title: string, message?: string) =>
      dispatch(addToast({ type: "info", title, message })),
    [dispatch]
  );

  const loading = useCallback(
    (id: string, title: string, message?: string) => {
      dispatch(addToast({ id, type: "loading", title, message, duration: 0 }));
      return () => dispatch(removeToast(id));
    },
    [dispatch]
  );

  const dismiss = useCallback(
    (id: string) => dispatch(removeToast(id)),
    [dispatch]
  );

  const dismissAllLoading = useCallback(
    () => dispatch(dismissLoading()),
    [dispatch]
  );

  return { success, error, info, loading, dismiss, dismissAllLoading };
}
