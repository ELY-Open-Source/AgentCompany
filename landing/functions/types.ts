export interface CounterDbStatement {
  bind(...values: unknown[]): {
    first<T = unknown>(): Promise<T | null>;
    run(): Promise<unknown>;
  };
}

export interface CounterDatabase {
  prepare(query: string): CounterDbStatement;
}

export interface PagesHandlerContext<Env> {
  request: Request;
  env: Env;
}

export type PagesHandler<Env> = (context: PagesHandlerContext<Env>) => Response | Promise<Response>;
