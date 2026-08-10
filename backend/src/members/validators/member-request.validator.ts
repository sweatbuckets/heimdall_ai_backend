import { BadRequestException } from "@nestjs/common";
import {
  CreateMemberRequest,
  LoginMemberRequest,
  SignUpMemberRequest,
  UpdateMemberRequest,
} from "../dto/member.dto";

const MAX_DISPLAY_NAME_LENGTH = 100;
const MAX_PROFILE_IMAGE_URL_LENGTH = 1000;
const MAX_EMAIL_LENGTH = 320;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_BYTES = 72;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateCreateMemberRequest(
  body: unknown,
): CreateMemberRequest {
  if (!isRecord(body)) {
    throw new BadRequestException("Request body must be an object.");
  }

  return {
    displayName: readRequiredString(
      body,
      "displayName",
      MAX_DISPLAY_NAME_LENGTH,
    ),
    profileImageUrl: readOptionalStringOrNull(
      body,
      "profileImageUrl",
      MAX_PROFILE_IMAGE_URL_LENGTH,
    ),
  };
}

export function validateSignUpMemberRequest(
  body: unknown,
): SignUpMemberRequest {
  if (!isRecord(body)) {
    throw new BadRequestException("Request body must be an object.");
  }

  const email = readEmail(body);
  const password = readPassword(body, MIN_PASSWORD_LENGTH);
  const displayName = readRequiredString(body, "displayName", 20);
  const age = readOptionalAge(body);

  return {
    email,
    password,
    displayName,
    profileImageUrl: readOptionalStringOrNull(
      body,
      "profileImageUrl",
      MAX_PROFILE_IMAGE_URL_LENGTH,
    ),
    gender: readOptionalStringOrNull(body, "gender", 20),
    age,
  };
}

export function validateLoginMemberRequest(body: unknown): LoginMemberRequest {
  if (!isRecord(body)) {
    throw new BadRequestException("Request body must be an object.");
  }

  return {
    email: readEmail(body),
    password: readPassword(body, 1),
  };
}

export function validateUpdateMemberRequest(
  body: unknown,
): UpdateMemberRequest {
  if (!isRecord(body)) {
    throw new BadRequestException("Request body must be an object.");
  }

  const input: UpdateMemberRequest = {};

  if (Object.prototype.hasOwnProperty.call(body, "displayName")) {
    input.displayName = readRequiredString(
      body,
      "displayName",
      MAX_DISPLAY_NAME_LENGTH,
    );
  }

  if (Object.prototype.hasOwnProperty.call(body, "profileImageUrl")) {
    input.profileImageUrl = readOptionalStringOrNull(
      body,
      "profileImageUrl",
      MAX_PROFILE_IMAGE_URL_LENGTH,
    );
  }

  if (Object.keys(input).length === 0) {
    throw new BadRequestException("At least one field must be provided.");
  }

  return input;
}

function readRequiredString(
  body: Record<string, unknown>,
  fieldName: string,
  maxLength: number,
): string {
  const value = body[fieldName];

  if (typeof value !== "string" || !value.trim()) {
    throw new BadRequestException(`${fieldName} must be a non-empty string.`);
  }

  const trimmed = value.trim();

  if (trimmed.length > maxLength) {
    throw new BadRequestException(
      `${fieldName} exceeds maximum length: ${maxLength}.`,
    );
  }

  return trimmed;
}

function readOptionalStringOrNull(
  body: Record<string, unknown>,
  fieldName: string,
  maxLength: number,
): string | null | undefined {
  const value = body[fieldName];

  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new BadRequestException(`${fieldName} must be a string or null.`);
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  if (trimmed.length > maxLength) {
    throw new BadRequestException(
      `${fieldName} exceeds maximum length: ${maxLength}.`,
    );
  }

  return trimmed;
}

function readEmail(body: Record<string, unknown>): string {
  const email = readRequiredString(
    body,
    "email",
    MAX_EMAIL_LENGTH,
  ).toLowerCase();

  if (!EMAIL_PATTERN.test(email)) {
    throw new BadRequestException("email must be a valid email address.");
  }

  return email;
}

function readPassword(
  body: Record<string, unknown>,
  minimumLength: number,
): string {
  const password = body.password;

  if (typeof password !== "string" || password.length < minimumLength) {
    throw new BadRequestException(
      `password must be at least ${minimumLength} characters.`,
    );
  }

  if (Buffer.byteLength(password, "utf8") > MAX_PASSWORD_BYTES) {
    throw new BadRequestException(
      `password exceeds maximum byte length: ${MAX_PASSWORD_BYTES}.`,
    );
  }

  return password;
}

function readOptionalAge(
  body: Record<string, unknown>,
): number | null | undefined {
  const age = body.age;
  if (age === undefined) return undefined;
  if (age === null) return null;
  if (
    typeof age !== "number" ||
    !Number.isInteger(age) ||
    age < 0 ||
    age > 150
  ) {
    throw new BadRequestException("age must be an integer between 0 and 150.");
  }
  return age;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
