import { ERROR_STATUS, type ErrorCode } from "@jetlag/shared";

export class AppError extends Error {
    readonly code: ErrorCode;
    readonly status: number;
    constructor(code: ErrorCode, message: string) {
        super(message);
        this.code = code;
        this.status = ERROR_STATUS[code];
    }
}

export const fail = (code: ErrorCode, message: string): never => {
    throw new AppError(code, message);
};
