declare module 'screenshot-desktop' {
  function screenshot(options?: { format?: 'png' | 'jpeg'; screen?: string | number }): Promise<Buffer>;
  namespace screenshot {
    function listDisplays(): Promise<{ id: string | number; name: string }[]>;
  }
  export = screenshot;
}
