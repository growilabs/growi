class GlobalEventTarget extends EventTarget {
  private static instance: GlobalEventTarget;

  static getInstance(): GlobalEventTarget {
    if (!GlobalEventTarget.instance) {
      GlobalEventTarget.instance = new GlobalEventTarget();
    }
    return GlobalEventTarget.instance;
  }
}

export const globalEventTarget = GlobalEventTarget.getInstance();
