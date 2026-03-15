import { memo } from "react";
import { Alert, AlertAction, AlertDescription } from "../ui/alert";
import { CircleAlertIcon, RefreshCwIcon, XIcon } from "lucide-react";
import { Button } from "../ui/button";

export const ThreadErrorBanner = memo(function ThreadErrorBanner({
  error,
  isSessionError,
  onDismiss,
  onRestartSession,
}: {
  error: string | null;
  isSessionError?: boolean;
  onDismiss?: () => void;
  onRestartSession?: () => void;
}) {
  if (!error) return null;
  return (
    <div className="mx-auto max-w-3xl pt-3">
      <Alert variant="error">
        <CircleAlertIcon />
        <AlertDescription className="line-clamp-3" title={error}>
          {error}
        </AlertDescription>
        <AlertAction>
          {isSessionError && onRestartSession && (
            <Button
              size="xs"
              variant="outline"
              className="gap-1 border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={onRestartSession}
            >
              <RefreshCwIcon className="size-3" />
              Restart Session
            </Button>
          )}
          {onDismiss && (
            <button
              type="button"
              aria-label="Dismiss error"
              className="inline-flex size-6 items-center justify-center rounded-md text-destructive/60 transition-colors hover:text-destructive"
              onClick={onDismiss}
            >
              <XIcon className="size-3.5" />
            </button>
          )}
        </AlertAction>
      </Alert>
    </div>
  );
});
