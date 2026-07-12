export interface CreateMemberRequest {
  displayName: string;
  profileImageUrl?: string | null;
}

export interface UpdateMemberRequest {
  displayName?: string;
  profileImageUrl?: string | null;
}

export interface MemberDto {
  id: string;
  displayName: string;
  profileImageUrl: string | null;
  createdAt: string;
  updatedAt: string;
}
