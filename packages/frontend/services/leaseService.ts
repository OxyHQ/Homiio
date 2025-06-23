import { api } from '@/utils/api';
import { OxyServices } from '@oxyhq/services';
import { API_URL } from '@/config';

export interface Lease {
  id: string;
  propertyId: string;
  property?: {
    id: string;
    title: string;
    address: {
      street: string;
      city: string;
      state: string;
      zipCode: string;
    };
  };
  landlordId: string;
  landlord?: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    phone?: string;
  };
  tenantId: string;
  tenant?: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    phone?: string;
  };
  status: 'draft' | 'pending_signature' | 'partially_signed' | 'fully_signed' | 'active' | 'terminated' | 'expired';
  startDate: string;
  endDate: string;
  rent: {
    amount: number;
    currency: string;
    dueDay: number;
    paymentMethod: 'bank_transfer' | 'faircoin' | 'credit_card' | 'cash';
    lateFee?: {
      amount: number;
      gracePeriod: number;
    };
  };
  deposit: {
    amount: number;
    currency: string;
    status: 'pending' | 'paid' | 'refunded';
    paidAt?: string;
  };
  terms: {
    duration: number; // months
    noticePeriod: number; // days
    petPolicy: 'allowed' | 'not_allowed' | 'case_by_case';
    smokingPolicy: 'allowed' | 'not_allowed' | 'outside_only';
    maintenanceResponsibility: 'landlord' | 'tenant' | 'shared';
    utilitiesIncluded?: string[];
    additionalTerms?: string[];
  };
  signatures: {
    landlord?: {
      signedAt: string;
      ipAddress: string;
      signature?: string;
    };
    tenant?: {
      signedAt: string;
      ipAddress: string;
      signature?: string;
    };
  };
  documents?: LeaseDocument[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateLeaseData {
  propertyId: string;
  tenantId: string;
  startDate: string;
  endDate: string;
  rent: {
    amount: number;
    currency: string;
    dueDay: number;
    paymentMethod: 'bank_transfer' | 'faircoin' | 'credit_card' | 'cash';
    lateFee?: {
      amount: number;
      gracePeriod: number;
    };
  };
  deposit: {
    amount: number;
    currency: string;
  };
  terms: {
    duration: number;
    noticePeriod: number;
    petPolicy: 'allowed' | 'not_allowed' | 'case_by_case';
    smokingPolicy: 'allowed' | 'not_allowed' | 'outside_only';
    maintenanceResponsibility: 'landlord' | 'tenant' | 'shared';
    utilitiesIncluded?: string[];
    additionalTerms?: string[];
  };
}

export interface LeaseFilters {
  status?: string;
  propertyId?: string;
  page?: number;
  limit?: number;
}

export interface Payment {
  id: string;
  leaseId: string;
  type: 'rent' | 'deposit' | 'late_fee' | 'utility' | 'maintenance';
  amount: number;
  currency: string;
  dueDate: string;
  paidAt?: string;
  status: 'pending' | 'paid' | 'overdue' | 'cancelled';
  paymentMethod: 'bank_transfer' | 'faircoin' | 'credit_card' | 'cash';
  reference?: string;
}

export interface CreatePaymentData {
  type: 'rent' | 'deposit' | 'late_fee' | 'utility' | 'maintenance';
  amount: number;
  currency: string;
  dueDate: string;
  paymentMethod: 'bank_transfer' | 'faircoin' | 'credit_card' | 'cash';
}

export interface LeaseDocument {
  id: string;
  leaseId: string;
  type: 'lease_agreement' | 'move_in_checklist' | 'move_out_checklist' | 'amendment' | 'other';
  filename: string;
  size: number;
  description?: string;
  uploadedBy: string;
  uploadedAt: string;
  downloadUrl: string;
}

class LeaseService {
  private baseUrl = '/api/leases';

  async getLeases(filters?: LeaseFilters, oxyServices?: OxyServices, activeSessionId?: string): Promise<{
    leases: Lease[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const response = await api.get(this.baseUrl, { 
      params: filters,
      oxyServices,
      activeSessionId,
    });
    return response.data;
  }

  async getLease(leaseId: string, oxyServices?: OxyServices, activeSessionId?: string): Promise<Lease> {
    const response = await api.get(`${this.baseUrl}/${leaseId}`, {
      oxyServices,
      activeSessionId,
    });
    return response.data.data;
  }

  async createLease(data: CreateLeaseData, oxyServices?: OxyServices, activeSessionId?: string): Promise<Lease> {
    const response = await api.post(this.baseUrl, data, {
      oxyServices,
      activeSessionId,
    });
    return response.data.data;
  }

  async updateLease(leaseId: string, data: Partial<CreateLeaseData>, oxyServices?: OxyServices, activeSessionId?: string): Promise<Lease> {
    const response = await api.put(`${this.baseUrl}/${leaseId}`, data, {
      oxyServices,
      activeSessionId,
    });
    return response.data.data;
  }

  async deleteLease(leaseId: string, oxyServices?: OxyServices, activeSessionId?: string): Promise<void> {
    await api.delete(`${this.baseUrl}/${leaseId}`, {
      oxyServices,
      activeSessionId,
    });
  }

  async signLease(leaseId: string, signature: string, acceptTerms: boolean, oxyServices?: OxyServices, activeSessionId?: string): Promise<Lease> {
    const response = await api.post(`${this.baseUrl}/${leaseId}/sign`, {
      signature,
      acceptTerms
    }, {
      oxyServices,
      activeSessionId,
    });
    return response.data.data;
  }

  async terminateLease(leaseId: string, reason: string, terminationDate: string, notice?: string, oxyServices?: OxyServices, activeSessionId?: string): Promise<void> {
    await api.post(`${this.baseUrl}/${leaseId}/terminate`, {
      reason,
      terminationDate,
      notice
    }, {
      oxyServices,
      activeSessionId,
    });
  }

  async renewLease(leaseId: string, data: {
    newStartDate: string;
    newEndDate: string;
    rentIncrease?: number;
    updatedTerms?: any;
  }, oxyServices?: OxyServices, activeSessionId?: string): Promise<Lease> {
    const response = await api.post(`${this.baseUrl}/${leaseId}/renew`, data, {
      oxyServices,
      activeSessionId,
    });
    return response.data.data;
  }

  async getLeasePayments(leaseId: string, filters?: {
    status?: string;
    page?: number;
    limit?: number;
  }, oxyServices?: OxyServices, activeSessionId?: string): Promise<{
    payments: Payment[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const response = await api.get(`${this.baseUrl}/${leaseId}/payments`, {
      params: filters,
      oxyServices,
      activeSessionId,
    });
    return response.data;
  }

  async createPayment(leaseId: string, data: CreatePaymentData, oxyServices?: OxyServices, activeSessionId?: string): Promise<Payment> {
    const response = await api.post(`${this.baseUrl}/${leaseId}/payments`, data, {
      oxyServices,
      activeSessionId,
    });
    return response.data.data;
  }

  async getLeaseDocuments(leaseId: string, oxyServices?: OxyServices, activeSessionId?: string): Promise<LeaseDocument[]> {
    const response = await api.get(`${this.baseUrl}/${leaseId}/documents`, {
      oxyServices,
      activeSessionId,
    });
    return response.data.data;
  }

  async uploadLeaseDocument(leaseId: string, file: File, type: string, description?: string, oxyServices?: OxyServices, activeSessionId?: string): Promise<LeaseDocument> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('type', type);
    if (description) {
      formData.append('description', description);
    }

    const headers: Record<string, string> = {};

    // Handle authentication if OxyServices is provided
    if (oxyServices && activeSessionId) {
      try {
        const tokenData = await oxyServices.getTokenBySession(activeSessionId);
        
        if (!tokenData) {
          throw new Error('No authentication token found');
        }
        
        headers['Authorization'] = `Bearer ${tokenData.accessToken}`;
      } catch (error) {
        console.error('Failed to get token:', error);
        throw new Error('Authentication failed');
      }
    }

    const response = await fetch(`${API_URL}${this.baseUrl}/${leaseId}/documents`, {
      method: 'POST',
      headers,
      body: formData,
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || data.error || `HTTP ${response.status}`);
    }

    return data.data;
  }

  // Utility methods
  async getActiveLeases(oxyServices?: OxyServices, activeSessionId?: string): Promise<Lease[]> {
    const response = await api.get(`${this.baseUrl}/active`, {
      oxyServices,
      activeSessionId,
    });
    return response.data.data;
  }

  async getPendingSignatureLeases(oxyServices?: OxyServices, activeSessionId?: string): Promise<Lease[]> {
    const response = await api.get(`${this.baseUrl}/pending-signature`, {
      oxyServices,
      activeSessionId,
    });
    return response.data.data;
  }

  async getUpcomingPayments(leaseId: string, oxyServices?: OxyServices, activeSessionId?: string): Promise<Payment[]> {
    const response = await api.get(`${this.baseUrl}/${leaseId}/upcoming-payments`, {
      oxyServices,
      activeSessionId,
    });
    return response.data.data;
  }
}

export const leaseService = new LeaseService();