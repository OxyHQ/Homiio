import api, { API_CONFIG, ApiError } from '@/utils/api';

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

  async getLeases(filters?: LeaseFilters): Promise<{
    leases: Lease[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const response = await api.get(this.baseUrl, { params: filters });
    return response.data;
  }

  async getLease(leaseId: string): Promise<Lease> {
    const response = await api.get(`${this.baseUrl}/${leaseId}`);
    return response.data.data;
  }

  async createLease(data: CreateLeaseData): Promise<Lease> {
    const response = await api.post(this.baseUrl, data);
    return response.data.data;
  }

  async updateLease(leaseId: string, data: Partial<CreateLeaseData>): Promise<Lease> {
    const response = await api.put(`${this.baseUrl}/${leaseId}`, data);
    
    
    return response.data.data;
  }

  async deleteLease(leaseId: string): Promise<void> {
    await api.delete(`${this.baseUrl}/${leaseId}`);
    
  }

  async signLease(leaseId: string, signature: string, acceptTerms: boolean): Promise<Lease> {
    const response = await api.post(`${this.baseUrl}/${leaseId}/sign`, {
      signature,
      acceptTerms
    });
    
    
    return response.data.data;
  }

  async terminateLease(leaseId: string, reason: string, terminationDate: string, notice?: string): Promise<void> {
    await api.post(`${this.baseUrl}/${leaseId}/terminate`, {
      reason,
      terminationDate,
      notice
    });
    
  }

  async renewLease(leaseId: string, data: {
    newEndDate: string;
    rentIncrease?: number;
    updatedTerms?: any;
  }): Promise<Lease> {
    const response = await api.post(`${this.baseUrl}/${leaseId}/renew`, data);
    
    
    return response.data.data;
  }

  async getLeasePayments(leaseId: string, filters?: {
    status?: string;
    page?: number;
    limit?: number;
  }): Promise<{
    payments: Payment[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const response = await api.get(`${this.baseUrl}/${leaseId}/payments`, { params: filters });
    return response.data;
  }

  async createPayment(leaseId: string, data: CreatePaymentData): Promise<Payment> {
    const response = await api.post(`${this.baseUrl}/${leaseId}/payments`, data);
    return response.data.data;
  }

  async getLeaseDocuments(leaseId: string): Promise<LeaseDocument[]> {
    const response = await api.get(`${this.baseUrl}/${leaseId}/documents`);
    return response.data.data;
  }

  async uploadLeaseDocument(leaseId: string, file: File, type: string, description?: string): Promise<LeaseDocument> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('type', type);
    if (description) {
      formData.append('description', description);
    }

    const response = await fetch(`${API_CONFIG.baseURL}${this.baseUrl}/${leaseId}/documents`, {
      method: 'POST',
      body: formData,
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      throw new ApiError(
        data.message || data.error || `HTTP ${response.status}`,
        response.status,
        data
      );
    }
    
    return data.data;
  }

  // Utility methods
  async getActiveLeases(): Promise<Lease[]> {
    try {
      const response = await this.getLeases({ status: 'active' });
      return response.leases;
    } catch (error) {
      console.error('Failed to get active leases:', error);
      return [];
    }
  }

  async getPendingSignatureLeases(): Promise<Lease[]> {
    try {
      const response = await this.getLeases({ status: 'pending_signature' });
      return response.leases;
    } catch (error) {
      console.error('Failed to get pending signature leases:', error);
      return [];
    }
  }

  async getUpcomingPayments(leaseId: string): Promise<Payment[]> {
    try {
      const response = await this.getLeasePayments(leaseId, { status: 'pending' });
      return response.payments;
    } catch (error) {
      console.error('Failed to get upcoming payments:', error);
      return [];
    }
  }
}

export const leaseService = new LeaseService();