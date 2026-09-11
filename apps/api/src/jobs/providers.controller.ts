import { Controller, Get, Param } from "@nestjs/common";
import { ApiError } from "../common/errors";
import { HEX_ADDRESS_RE } from "@vouch/shared/schemas";
import { JobsService } from "./jobs.service";

/** Public provider reputation (Graph-authoritative, fail-closed). Separate prefix — no /jobs collision. */
@Controller("providers")
export class ProvidersController {
  constructor(private readonly jobs: JobsService) {}

  @Get(":address/performance")
  async performance(@Param("address") address: string): Promise<unknown> {
    if (!HEX_ADDRESS_RE.test(address)) throw new ApiError("NOT_FOUND", "Malformed address");
    const row = await this.jobs.providerPerformance(address);
    if (!row) throw new ApiError("NOT_FOUND", "No indexed performance for this provider");
    return row;
  }
}
