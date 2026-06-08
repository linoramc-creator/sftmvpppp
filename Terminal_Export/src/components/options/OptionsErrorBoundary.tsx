import React from "react";
import { AlertCircle } from "lucide-react";

interface Props {
  children: React.ReactNode;
}
interface State {
  hasError: boolean;
  message: string;
}

// Keeps a rendering crash in any options chart from taking down the whole app.
export class OptionsErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message };
  }

  componentDidCatch(error: Error) {
    console.error("[OptionsErrorBoundary]", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-center border border-border bg-card">
          <AlertCircle className="h-5 w-5 text-destructive" />
          <div className="text-[11px] tracking-widest text-muted-foreground uppercase">
            Error al renderizar opciones
          </div>
          <div className="text-[10px] text-muted-foreground/50 font-mono max-w-md">
            {this.state.message}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
