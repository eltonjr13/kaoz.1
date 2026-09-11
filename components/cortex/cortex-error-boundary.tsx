"use client";

import React, { Component, type ReactNode, type ErrorInfo } from "react";
import { CortexErrorState } from "./cortex-ui-states";

export interface CortexSectionErrorBoundaryProps {
  section: string;
  children: ReactNode;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class CortexSectionErrorBoundary extends Component<
  CortexSectionErrorBoundaryProps,
  State
> {
  constructor(props: CortexSectionErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(
      `[CortexSectionErrorBoundary] Erro na seção '${this.props.section}':`,
      error,
      errorInfo
    );
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="my-4 w-full min-w-0">
          <CortexErrorState
            title={`Falha na seção ${this.props.section}`}
            message={
              this.state.error?.message ||
              "Ocorreu um erro inesperado ao renderizar esta seção do Córtex."
            }
            code="SECTION_CRASH_PROTECTED"
            onRetry={this.handleRetry}
          />
        </div>
      );
    }

    return this.props.children;
  }
}
