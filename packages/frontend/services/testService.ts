import { api } from '@/utils/api';

interface TestPayload {
  title: string;
  content: string;
}

export const runTest = async (payload: TestPayload) => {
  const response = await api.post('/api/test', payload);
  return response.data;
};

