declare global {
  interface NodeModule {
    hot: {
      status(): string;
      check(autoApply: boolean): Promise<any>;
      apply(options: any): Promise<any>;
      accept(dependencies?: string[], callback?: () => void): void;
      decline(dependencies?: string[]): void;
      dispose(callback: (data: any) => void): void;
      addDisposeHandler(callback: (data: any) => void): void;
      removeDisposeHandler(callback: (data: any) => void): void;
      data: any;
      addStatusHandler(callback: (status: string) => void): void;
      removeStatusHandler(callback: (status: string) => void): void;
    };
  }
}

export {};
