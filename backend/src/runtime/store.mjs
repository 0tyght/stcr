export class RuntimeStore {
  #values = new Map();

  get(key) {
    return this.#values.get(key);
  }

  set(key, value) {
    if (value === undefined) {
      this.#values.delete(key);
      return;
    }
    this.#values.set(key, value);
  }

  keys() {
    return [...this.#values.keys()];
  }

  clear() {
    this.#values.clear();
  }
}

export const globalStore = new RuntimeStore();
export const apiContextStore = new RuntimeStore();
export const mqttAdapterContextStore = new RuntimeStore();
export const mqttWriterContextStore = new RuntimeStore();
export const flowStore = new RuntimeStore();
