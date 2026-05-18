import { useMutation } from '@tanstack/react-query';
import { openBillingPortal } from './api';

export function useBillingPortal() {
  return useMutation({
    mutationFn: openBillingPortal,
    onSuccess: (data: any) => {
      window.location.href = data.url;
    },
  });
}
