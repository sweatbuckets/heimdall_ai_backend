export interface CreateMemberRequest {
  displayName: string;
  profileImageUrl?: string | null;
}

export interface SignUpMemberRequest {
  email: string;
  password: string;
  displayName: string;
  profileImageUrl?: string | null;
  gender?: string | null;
  age?: number | null;
}

export interface LoginMemberRequest {
  email: string;
  password: string;
}

export interface UpdateMemberRequest {
  displayName?: string;
  profileImageUrl?: string | null;
}

export interface MemberDto {
  id: string;
  email: string | null;
  displayName: string;
  profileImageUrl: string | null;
  gender: string | null;
  age: number | null;
  score: number;
  createdAt: string;
  updatedAt: string;
}
