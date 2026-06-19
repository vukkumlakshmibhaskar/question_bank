import { defineStore } from "pinia";
import { ref } from "vue";

export const useNotificationStore = defineStore("notification", () => {
  const toasts = ref([]);

  const add = (message, type = "info", duration = 4000) => {
    const id = Date.now() + Math.random().toString(36).substring(2, 9);
    toasts.value.push({ id, message, type, duration });

    setTimeout(() => {
      remove(id);
    }, duration);
  };

  const success = (message, duration) => add(message, "success", duration);
  const error = (message, duration) => add(message, "error", duration);
  const info = (message, duration) => add(message, "info", duration);
  const warning = (message, duration) => add(message, "warning", duration);

  const remove = (id) => {
    toasts.value = toasts.value.filter((t) => t.id !== id);
  };

  return {
    toasts,
    add,
    success,
    error,
    info,
    warning,
    remove,
  };
});
