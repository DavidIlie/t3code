import { useCallback, useEffect, useRef, useState } from "react";

interface UseCopyToClipboardOptions<TContext = void> {
  timeout?: number;
  onCopy?: (context: TContext) => void;
  onError?: (error: unknown) => void;
}

interface UseCopyToClipboardReturn<TContext = void> {
  copyToClipboard: (value: string, ...args: TContext extends void ? [] : [TContext]) => void;
  isCopied: boolean;
}

export function useCopyToClipboard<TContext = void>(
  options: UseCopyToClipboardOptions<TContext> = {},
): UseCopyToClipboardReturn<TContext> {
  const { timeout = 2000, onCopy, onError } = options;
  const [isCopied, setIsCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onCopyRef = useRef(onCopy);
  const onErrorRef = useRef(onError);
  onCopyRef.current = onCopy;
  onErrorRef.current = onError;

  useEffect(
    () => () => {
      if (timerRef.current != null) {
        clearTimeout(timerRef.current);
      }
    },
    [],
  );

  const copyToClipboard = useCallback(
    (value: string, ...args: TContext extends void ? [] : [TContext]) => {
      if (typeof navigator === "undefined" || navigator.clipboard?.writeText === undefined) {
        onErrorRef.current?.(new Error("Clipboard API unavailable."));
        return;
      }

      void navigator.clipboard
        .writeText(value)
        .then(() => {
          if (timerRef.current != null) {
            clearTimeout(timerRef.current);
          }
          setIsCopied(true);
          timerRef.current = setTimeout(() => {
            setIsCopied(false);
            timerRef.current = null;
          }, timeout);
          const context = args[0] as TContext;
          onCopyRef.current?.(context);
        })
        .catch((error: unknown) => {
          onErrorRef.current?.(error);
        });
    },
    [timeout],
  );

  return { copyToClipboard, isCopied };
}
