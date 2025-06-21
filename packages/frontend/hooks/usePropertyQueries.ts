import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { propertyService, Property, CreatePropertyData, PropertyFilters } from '@/services/propertyService';
import { roomService, Room, CreateRoomData, RoomFilters } from '@/services/roomService';
import { toast } from 'sonner';

// Property Query Keys
export const propertyKeys = {
  all: ['properties'] as const,
  lists: () => [...propertyKeys.all, 'list'] as const,
  list: (filters: PropertyFilters) => [...propertyKeys.lists(), { filters }] as const,
  details: () => [...propertyKeys.all, 'detail'] as const,
  detail: (id: string) => [...propertyKeys.details(), id] as const,
  stats: (id: string) => [...propertyKeys.detail(id), 'stats'] as const,
  energy: (id: string, period: string) => [...propertyKeys.detail(id), 'energy', period] as const,
  search: (query: string, filters?: PropertyFilters) => [...propertyKeys.all, 'search', query, filters] as const,
};

// Room Query Keys
export const roomKeys = {
  all: ['rooms'] as const,
  lists: () => [...roomKeys.all, 'list'] as const,
  list: (propertyId: string, filters?: RoomFilters) => [...roomKeys.lists(), propertyId, { filters }] as const,
  details: () => [...roomKeys.all, 'detail'] as const,
  detail: (propertyId: string, roomId: string) => [...roomKeys.details(), propertyId, roomId] as const,
  stats: (propertyId: string, roomId: string) => [...roomKeys.detail(propertyId, roomId), 'stats'] as const,
  energy: (propertyId: string, roomId: string, period: string) => [...roomKeys.detail(propertyId, roomId), 'energy', period] as const,
  search: (propertyId: string, query: string, filters?: RoomFilters) => [...roomKeys.all, 'search', propertyId, query, filters] as const,
};

// Property Hooks
export function useProperties(filters?: PropertyFilters) {
  return useQuery({
    queryKey: propertyKeys.list(filters || {}),
    queryFn: () => propertyService.getProperties(filters),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

export function useProperty(id: string) {
  return useQuery({
    queryKey: propertyKeys.detail(id),
    queryFn: () => propertyService.getProperty(id),
    enabled: !!id,
  });
}

export function usePropertyStats(id: string) {
  return useQuery({
    queryKey: propertyKeys.stats(id),
    queryFn: () => propertyService.getPropertyStats(id),
    enabled: !!id,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

export function usePropertyEnergyStats(id: string, period: 'day' | 'week' | 'month' = 'day') {
  return useQuery({
    queryKey: propertyKeys.energy(id, period),
    queryFn: () => propertyService.getPropertyEnergyStats(id, period),
    enabled: !!id,
    staleTime: 60 * 1000, // 1 minute
  });
}

export function useSearchProperties(query: string, filters?: PropertyFilters) {
  return useQuery({
    queryKey: propertyKeys.search(query, filters),
    queryFn: () => propertyService.searchProperties(query, filters),
    enabled: !!query && query.length > 0,
    staleTime: 60 * 1000, // 1 minute
  });
}

export function useCreateProperty() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreatePropertyData) => propertyService.createProperty(data),
    onSuccess: (createdProperty: Property) => {
      queryClient.invalidateQueries({ queryKey: propertyKeys.lists() });
      toast.success('Property created successfully');
      return createdProperty;
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to create property');
    },
  });
}

export function useUpdateProperty() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<CreatePropertyData> }) =>
      propertyService.updateProperty(id, data),
    onSuccess: (data: Property, variables: { id: string; data: Partial<CreatePropertyData> }) => {
      queryClient.invalidateQueries({ queryKey: propertyKeys.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: propertyKeys.lists() });
      toast.success('Property updated successfully');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to update property');
    },
  });
}

export function useDeleteProperty() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => propertyService.deleteProperty(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: propertyKeys.lists() });
      toast.success('Property deleted successfully');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to delete property');
    },
  });
}

// Room Hooks
export function useRooms(propertyId: string, filters?: RoomFilters) {
  return useQuery({
    queryKey: roomKeys.list(propertyId, filters),
    queryFn: () => roomService.getRooms(propertyId, filters),
    enabled: !!propertyId,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

export function useRoom(propertyId: string, roomId: string) {
  return useQuery({
    queryKey: roomKeys.detail(propertyId, roomId),
    queryFn: () => roomService.getRoom(propertyId, roomId),
    enabled: !!propertyId && !!roomId,
  });
}

export function useRoomStats(propertyId: string, roomId: string) {
  return useQuery({
    queryKey: roomKeys.stats(propertyId, roomId),
    queryFn: () => roomService.getRoomStats(propertyId, roomId),
    enabled: !!propertyId && !!roomId,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

export function useRoomEnergyStats(propertyId: string, roomId: string, period: 'day' | 'week' | 'month' = 'day') {
  return useQuery({
    queryKey: roomKeys.energy(propertyId, roomId, period),
    queryFn: () => roomService.getRoomEnergyStats(propertyId, roomId, period),
    enabled: !!propertyId && !!roomId,
    staleTime: 60 * 1000, // 1 minute
  });
}

export function useSearchRooms(propertyId: string, query: string, filters?: RoomFilters) {
  return useQuery({
    queryKey: roomKeys.search(propertyId, query, filters),
    queryFn: () => roomService.searchRooms(propertyId, query, filters),
    enabled: !!propertyId && !!query && query.length > 0,
    staleTime: 60 * 1000, // 1 minute
  });
}

export function useCreateRoom() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ propertyId, data }: { propertyId: string; data: CreateRoomData }) =>
      roomService.createRoom(propertyId, data),
    onSuccess: (data: Room, variables: { propertyId: string; data: CreateRoomData }) => {
      queryClient.invalidateQueries({ queryKey: roomKeys.list(variables.propertyId) });
      queryClient.invalidateQueries({ queryKey: propertyKeys.detail(variables.propertyId) });
      toast.success('Room created successfully');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to create room');
    },
  });
}

export function useUpdateRoom() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ propertyId, roomId, data }: { propertyId: string; roomId: string; data: Partial<CreateRoomData> }) =>
      roomService.updateRoom(propertyId, roomId, data),
    onSuccess: (data: Room, variables: { propertyId: string; roomId: string; data: Partial<CreateRoomData> }) => {
      queryClient.invalidateQueries({ queryKey: roomKeys.detail(variables.propertyId, variables.roomId) });
      queryClient.invalidateQueries({ queryKey: roomKeys.list(variables.propertyId) });
      toast.success('Room updated successfully');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to update room');
    },
  });
}

export function useDeleteRoom() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ propertyId, roomId }: { propertyId: string; roomId: string }) =>
      roomService.deleteRoom(propertyId, roomId),
    onSuccess: (data: void, variables: { propertyId: string; roomId: string }) => {
      queryClient.invalidateQueries({ queryKey: roomKeys.list(variables.propertyId) });
      queryClient.invalidateQueries({ queryKey: propertyKeys.detail(variables.propertyId) });
      toast.success('Room deleted successfully');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to delete room');
    },
  });
}

export function useAssignTenant() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ propertyId, roomId, tenantId }: { propertyId: string; roomId: string; tenantId: string }) =>
      roomService.assignTenant(propertyId, roomId, tenantId),
    onSuccess: (data: Room, variables: { propertyId: string; roomId: string; tenantId: string }) => {
      queryClient.invalidateQueries({ queryKey: roomKeys.detail(variables.propertyId, variables.roomId) });
      queryClient.invalidateQueries({ queryKey: roomKeys.list(variables.propertyId) });
      toast.success('Tenant assigned successfully');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to assign tenant');
    },
  });
}

export function useUnassignTenant() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ propertyId, roomId }: { propertyId: string; roomId: string }) =>
      roomService.unassignTenant(propertyId, roomId),
    onSuccess: (data: Room, variables: { propertyId: string; roomId: string }) => {
      queryClient.invalidateQueries({ queryKey: roomKeys.detail(variables.propertyId, variables.roomId) });
      queryClient.invalidateQueries({ queryKey: roomKeys.list(variables.propertyId) });
      toast.success('Tenant unassigned successfully');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to unassign tenant');
    },
  });
}
