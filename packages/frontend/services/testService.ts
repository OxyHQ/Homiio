import { postData } from '@/utils/api';

interface TestPayload {
  title: string;
  content: string;
}

export const runTest = async (payload: TestPayload) => {
  return postData('/api/test', payload);
};

