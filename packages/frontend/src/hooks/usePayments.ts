import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CreatePaymentRequest } from '@payment-platform/shared';
import { apiRequest, apiRequestFull } from '@/lib/api-client';
import { Payment, PaymentWithTransaction, PaginatedResult } from '@/lib/types';

interface ListPaymentsParams {
  page?: number;
  limit?: number;
  status?: string;
}

export function usePayments(params: ListPaymentsParams = {}) {
  return useQuery({
    queryKey: ['payments', params],
    queryFn: async (): Promise<PaginatedResult<Payment>> => {
      const query = new URLSearchParams();
      if (params.page) query.set('page', String(params.page));
      if (params.limit) query.set('limit', String(params.limit));
      if (params.status) query.set('status', params.status);

      const res = await apiRequestFull<Payment[]>(`/api/payments?${query.toString()}`);
      return {
        items: res.data || [],
        page: res.metadata?.page || 1,
        limit: res.metadata?.limit || 25,
        total: res.metadata?.total || 0,
        totalPages: Math.ceil((res.metadata?.total || 0) / (res.metadata?.limit || 25)),
      };
    },
  });
}

export function usePayment(id: string | undefined) {
  return useQuery({
    queryKey: ['payments', id],
    queryFn: () => apiRequest<Payment>(`/api/payments/${id}`),
    enabled: Boolean(id),
  });
}

export function useCreatePayment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreatePaymentRequest) =>
      apiRequest<PaymentWithTransaction>('/api/payments', { method: 'POST', body: data }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['payments'] }),
  });
}

export function useCapturePayment(paymentId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { amount?: number }) =>
      apiRequest<PaymentWithTransaction>(`/api/payments/${paymentId}/capture`, { method: 'POST', body: data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payments'] });
    },
  });
}

export function useRefundPayment(paymentId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { amount?: number; reason?: string }) =>
      apiRequest<PaymentWithTransaction>(`/api/payments/${paymentId}/refund`, { method: 'POST', body: data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payments'] });
    },
  });
}

export function useCancelPayment(paymentId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { reason?: string }) =>
      apiRequest<PaymentWithTransaction>(`/api/payments/${paymentId}/cancel`, { method: 'POST', body: data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payments'] });
    },
  });
}
