import { BadRequestException } from "@nestjs/common";
import { CreateMemberRequest, UpdateMemberRequest } from "../dto/member.dto";

const MAX_DISPLAY_NAME_LENGTH = 100;
const MAX_PROFILE_IMAGE_URL_LENGTH = 1000;

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
