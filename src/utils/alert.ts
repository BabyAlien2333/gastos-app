import { Platform } from 'react-native';

type AlertButton = {
  text?: string;
  onPress?: () => void;
  style?: 'default' | 'cancel' | 'destructive';
};

export function showAlert(title: string, message?: string, buttons?: AlertButton[]) {
  if (Platform.OS !== 'web') {
    showAlert(title, message, buttons);
    return;
  }

  // Web: no existe Alert nativo, usamos window.alert / window.confirm
  if (!buttons || buttons.length <= 1) {
    window.alert(message ? `${title}\n\n${message}` : title);
    buttons?.[0]?.onPress?.();
    return;
  }

  // Con 2+ botones, simulamos un confirm: el botón "cancel" es cancelar,
  // cualquier otro botón se dispara si el usuario acepta.
  const cancelBtn = buttons.find(b => b.style === 'cancel');
  const confirmBtn = buttons.find(b => b.style !== 'cancel') || buttons[buttons.length - 1];

  const confirmed = window.confirm(message ? `${title}\n\n${message}` : title);
  if (confirmed) {
    confirmBtn?.onPress?.();
  } else {
    cancelBtn?.onPress?.();
  }
}