import { defineStore } from "pinia";
import { ref } from "vue";

export const useConfirmationStore = defineStore("confirmation", () => {
  const isOpen = ref(false);
  const title = ref("Confirm Action");
  const message = ref("Are you sure you want to proceed?");
  const confirmText = ref("Confirm");
  const cancelText = ref("Cancel");
  const isDanger = ref(false);
  
  let resolvePromise = null;

  const ask = (options = {}) => {
    title.value = options.title || "Confirm Action";
    message.value = options.message || "Are you sure you want to proceed?";
    confirmText.value = options.confirmText || "Confirm";
    cancelText.value = options.cancelText || "Cancel";
    isDanger.value = options.isDanger || false;
    
    isOpen.value = true;

    return new Promise((resolve) => {
      resolvePromise = resolve;
    });
  };

  const confirm = () => {
    isOpen.value = false;
    if (resolvePromise) resolvePromise(true);
  };

  const cancel = () => {
    isOpen.value = false;
    if (resolvePromise) resolvePromise(false);
  };

  return {
    isOpen,
    title,
    message,
    confirmText,
    cancelText,
    isDanger,
    ask,
    confirm,
    cancel,
  };
});
