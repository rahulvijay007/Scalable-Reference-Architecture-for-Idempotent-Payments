import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api-client';
import { ApiKey } from '@/lib/types';

export function useApiKeys(merchantId: string | undefined) {
  return useQuery({
    queryKey: ['api-keys', merchantId],
    queryFn: () => apiRequest<ApiKey[]>(`/api/merchants/${merchantId}/api-keys`),
    enabled: Boolean(merchantId),
  });
}

export function useCreateApiKey(merchantId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (name: string) =>
      apiRequest<ApiKey>(`/api/merchants/${merchantId}/api-keys`, { method: 'POST', body: { name } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['api-keys', merchantId] }),
  });
}

export function useRevokeApiKey(merchantId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (keyId: string) =>
      apiRequest<null>(`/api/merchants/${merchantId}/api-keys/${keyId}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['api-keys', merchantId] }),
  });
}
