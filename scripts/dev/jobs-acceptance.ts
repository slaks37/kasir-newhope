import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Db } from "../../services/shared/db";
import { workflowStages } from "../../src/platform/modules/domainWorkflow";
import type { BusinessModuleId } from "../../src/platform/modules/contracts";
export async function jobsAcceptance(
  admin: Db,
  request: any,
  scope: any,
  save: any,
  ids: any,
  peerRequest?: any,
) {
  process.env.NEW_HOPE_MODULE_DOMAIN_WORKFLOWS = "1";
  const sectors = {
    fnb: "FNB",
    retail: "RETAIL",
    laundry: "LAUNDRY",
    carwash: "CARWASH",
    barber: "BARBERSHOP",
  };
  const path = "/api/v1/sync/modules/jobs",
    result: any = {};
  try {
    for (const moduleId of [
      "fnb",
      "retail",
      "laundry",
      "carwash",
      "barber",
    ] as BusinessModuleId[]) {
      const s = scope(moduleId);
      await admin.query(
        "INSERT INTO internal.merchant_modules(tenant_id,merchant_id,module_id,enabled,guard_legacy_apis,workspace_version) VALUES($1,$2,$3,true,true,2) ON CONFLICT DO NOTHING",
        [ids.tenant, ids.merchant, moduleId],
      );
      await admin.query(
        "INSERT INTO billing.module_entitlements(tenant_id,merchant_id,module_id,enabled,features,expires_at,grant_reference) VALUES($1,$2,$3,true,ARRAY['overview','pos','tables','inventory','reports','settings','customers','labor'],now()+interval '1 day','synthetic-jobs-only') ON CONFLICT DO NOTHING",
        [ids.tenant, ids.merchant, moduleId],
      );
      const productRef = "job-product-" + moduleId;
      let r = await save(
        s,
        "products",
        productRef,
        {
          id: productRef,
          name: "Synthetic " + moduleId + " service",
          sku: randomUUID(),
          price: 100,
          costPrice: 10,
          inventoryTracked: false,
          variants: [{ id: "large", name: "Large", priceExtra: 20 }],
          modifierGroups: [
            {
              id: "extras",
              name: "Extras",
              required: true,
              minSelect: 1,
              maxSelect: 1,
              options: [{ id: "care", name: "Care", price: 5 }],
            },
          ],
        },
        "owner",
      );
      assert.equal(r.status, 200, JSON.stringify(r));
      // Use an existing dedicated register for Retail/Barber; configure the other modules explicitly.
      if (!["retail", "barber"].includes(moduleId)) {
        r = await request(
          "/api/v1/finance/registers",
          {
            ...s,
            registerId: randomUUID(),
            name: "Synthetic " + moduleId,
            moduleIds: [moduleId],
          },
          "owner",
        );
        assert.equal(r.status, 200, JSON.stringify(r));
        r = await request(
          "/api/v1/finance/shift/open",
          { ...s, clientShiftId: randomUUID(), initialCash: 0 },
          "cashierA",
        );
        assert.equal(r.status, 200, JSON.stringify(r));
      }
      const shift = await request(
        "/api/v1/finance/shift?" + new URLSearchParams(s),
        undefined,
        "cashierA",
      );
      assert.equal(shift.status, 200, JSON.stringify(shift));
      assert(shift.data.shift);
      if (moduleId === "retail") {
        r = await request(
          "/api/v1/sync/modules/inventory",
          {
            ...s,
            action: "RECEIVE",
            commandId: randomUUID(),
            lines: [{ productRef, quantity: 10 }],
          },
          "owner",
        );
        assert.equal(r.status, 200, JSON.stringify(r));
      }
      if (moduleId === "fnb") {
        const table = await save(
          s,
          "tables",
          "Table A",
          {
            id: "Table A",
            name: "Synthetic Table A",
            capacity: 4,
            zone: "MAIN",
            status: "AVAILABLE",
          },
          "owner",
        );
        assert.equal(table.status, 200, JSON.stringify(table));
      }
      const laborPath = "/api/v1/sync/modules/labor";
      const staffId = ids.manager;
      const rule = {
        ...s,
        action: "SET_RULE",
        commandId: randomUUID(),
        staffId,
        kind: moduleId === "barber" ? "FIXED_PER_ORDER" : "PERCENTAGE",
        rate: moduleId === "barber" ? 50 : 10,
        baseRevision: 0,
      };
      r = await request(laborPath, rule, "manager");
      assert.equal(r.status, 200, JSON.stringify(r));
      assert.equal(
        (await request(laborPath, rule, "manager")).data.replayed,
        true,
      );
      assert.equal(
        (
          await request(
            laborPath,
            { ...rule, commandId: randomUUID(), rate: 20 },
            "manager",
          )
        ).status,
        409,
        "Rule revisions reject lost updates",
      );
      assert.equal(
        (
          await request(
            laborPath + "?" + new URLSearchParams({ ...s, staffId }),
            undefined,
            "cashierA",
          )
        ).status,
        403,
      );
      const line = {
        id: "service-line",
        productRef,
        quantity: 2.5,
        variantId: "large",
        selectedModifiers: [{ groupId: "extras", optionId: "care" }],
      };
      const intake = {
        ...s,
        action: "CREATE",
        commandId: randomUUID(),
        jobId: randomUUID(),
        customerName: "Synthetic customer",
        customerPhone: "0000000000",
        assignedStaffId: ids.manager,
        orderType: "DINE_IN",
        resource: moduleId === "fnb" ? "Table A" : undefined,
        collection: "PICKUP",
        vehiclePlate: "TEST-000",
        vehicleModel: "Synthetic vehicle",
        ...(moduleId === "barber"
          ? {
              assignedStaffId: ids.manager,
              scheduledStart: "2030-01-01T10:00:00Z",
              scheduledEnd: "2030-01-01T11:00:00Z",
            }
          : {}),
        lines: [line],
      };
      r = await request(path, intake, "cashierA");
      assert.equal(r.status, 200, JSON.stringify(r));
      assert.equal(r.data.revision, 1);
      assert.equal(
        (await request(path, intake, "cashierA")).data.replayed,
        true,
      );
      assert.equal(
        (
          await request(
            path,
            { ...intake, customerName: "Changed" },
            "cashierA",
          )
        ).status,
        409,
      );
      assert.equal(
        (
          await request(
            path,
            {
              ...s,
              action: "TRANSITION",
              commandId: randomUUID(),
              jobId: intake.jobId,
              baseRevision: 1,
              status: workflowStages[moduleId].at(-1),
            },
            "cashierA",
          )
        ).status,
        409,
        "A status cannot skip the lifecycle",
      );
      if (moduleId === "barber") {
        const conflict = await request(
          path,
          {
            ...intake,
            jobId: randomUUID(),
            commandId: randomUUID(),
            scheduledStart: "2030-01-01T10:30:00Z",
            scheduledEnd: "2030-01-01T11:30:00Z",
          },
          "cashierA",
        );
        assert.equal(conflict.status, 409, JSON.stringify(conflict));
        assert.equal(conflict.data.error, "STAFF_OR_RESOURCE_BOOKING_CONFLICT");
      }
      if (moduleId === "fnb") {
        const elsewhere = {
          ...intake,
          jobId: randomUUID(),
          commandId: randomUUID(),
          outletId: ids.b,
          orderType: "TAKEAWAY",
          resource: undefined,
        };
        const crossOutlet = await request(path, elsewhere, "manager");
        assert.equal(crossOutlet.status, 409, JSON.stringify(crossOutlet));
        assert.equal(
          crossOutlet.data.error,
          "STAFF_OR_RESOURCE_BOOKING_CONFLICT",
        );
        const crossModule = await request(
          path,
          {
            ...intake,
            jobId: randomUUID(),
            commandId: randomUUID(),
            moduleId: "barber",
            resource: undefined,
            scheduledStart: "2030-01-01T10:00:00Z",
            scheduledEnd: "2030-01-01T11:00:00Z",
          },
          "manager",
        );
        assert.equal(crossModule.status, 409, JSON.stringify(crossModule));
      }
      if (moduleId === "fnb")
        assert.equal(
          (
            await request(
              path,
              { ...intake, jobId: randomUUID(), commandId: randomUUID() },
              "cashierA",
            )
          ).status,
          409,
          "A dining table cannot have two active orders",
        );
      const pay = (quantity: number) => ({
        ...s,
        sector: sectors[moduleId],
        idempotencyKey: randomUUID(),
        transactions: [
          {
            clientTxnId: randomUUID(),
            operationalJobId: intake.jobId,
            shiftId: shift.data.shift.id,
            createdAt: new Date().toISOString(),
            subtotal: 125 * quantity,
            totalAmount: 125 * quantity,
            paymentMethod: "CASH",
            paymentStatus: "PAID",
            items: [
              {
                ...line,
                clientItemId: line.id,
                productName: "Spoofed name",
                unitPrice: 125,
                unitCost: 0,
                quantity,
                totalPrice: 125 * quantity,
              },
            ],
          },
        ],
      });
      let revision = 1;
      for (const stage of workflowStages[moduleId].slice(1, -1)) {
        r = await request(
          path,
          {
            ...s,
            action: "TRANSITION",
            commandId: randomUUID(),
            jobId: intake.jobId,
            baseRevision: revision,
            status: stage,
          },
          "cashierA",
        );
        assert.equal(r.status, 200, JSON.stringify(r));
        revision = r.data.revision;
      }
      const early = await request(
        laborPath + "?" + new URLSearchParams({ ...s, staffId }),
        undefined,
        "manager",
      );
      assert.equal(
        early.data.ledger.length,
        0,
        "Unpaid or unfinished service earns nothing",
      );
      const final = {
        ...s,
        action: "TRANSITION",
        commandId: randomUUID(),
        jobId: intake.jobId,
        baseRevision: revision,
        status: workflowStages[moduleId].at(-1),
      };
      assert.equal(
        (await request(path, final, "cashierA")).data.error,
        "AUTHORITATIVE_PAYMENT_REQUIRED",
      );
      const first = pay(1);
      r = await request("/api/v1/sync/transactions", first, "cashierA");
      assert.equal(r.data.accepted, 1, JSON.stringify(r));
      assert.equal(
        (await request("/api/v1/sync/transactions", first, "cashierA")).data
          .replayed,
        true,
      );
      assert.equal(
        (await request(path, { ...final, commandId: randomUUID() }, "cashierA"))
          .data.error,
        "AUTHORITATIVE_PAYMENT_REQUIRED",
        "A split bill cannot falsely complete a partially paid order",
      );
      const partial = await request(
        path + "?" + new URLSearchParams(s),
        undefined,
        "cashierA",
      );
      assert.equal(
        partial.data.jobs.find((j: any) => j.id === intake.jobId).remaining[
          line.id
        ],
        1.5,
      );
      const over = pay(2);
      r = await request("/api/v1/sync/transactions", over, "cashierA");
      assert.equal(r.data.accepted, 0);
      assert.equal(r.data.rejected[0].error, "JOB_QUOTE_OR_QUANTITY_MISMATCH");
      const missing = pay(1.5);
      missing.transactions[0].items[0].selectedModifiers = [];
      r = await request("/api/v1/sync/transactions", missing, "cashierA");
      assert.equal(r.data.accepted, 0);
      assert.equal(r.data.rejected[0].error, "JOB_QUOTE_OR_QUANTITY_MISMATCH");
      await admin.query(
        "UPDATE pos.products SET price=999 WHERE merchant_id=$1 AND module_id=$2 AND workspace_payload->>'id'=$3",
        [ids.merchant, moduleId, productRef],
      );
      const second = pay(1.5);
      r = await request("/api/v1/sync/transactions", second, "cashierA");
      assert.equal(r.data.accepted, 1, JSON.stringify(r));
      const detail = await request(
        path + "?" + new URLSearchParams(s),
        undefined,
        "cashierA",
      );
      assert.equal(detail.status, 200, JSON.stringify(detail));
      const persisted = detail.data.jobs.find(
        (j: any) => j.id === intake.jobId,
      );
      assert.equal(persisted.paid, true);
      assert.equal(persisted.intake.lines[0].unitPrice, 125);
      assert.equal(persisted.intake.customerName, intake.customerName);
      r = await request(path, final, "cashierA");
      assert.equal(r.status, 200, JSON.stringify(r));
      assert.equal(r.data.status, workflowStages[moduleId].at(-1));
      assert.equal(
        (await request(path, final, "cashierA")).data.replayed,
        true,
      );
      assert.equal(
        (
          await request(
            path,
            {
              ...s,
              outletId: ids.b,
              action: "TRANSITION",
              commandId: randomUUID(),
              jobId: intake.jobId,
              baseRevision: r.data.revision,
              status: "CANCELLED",
            },
            "manager",
          )
        ).status,
        404,
      );
      const periodEnd = new Date().toISOString().slice(0, 10),
        laborQuery =
          laborPath + "?" + new URLSearchParams({ ...s, staffId, periodEnd });
      const earned = await request(laborQuery, undefined, "manager");
      assert.equal(earned.status, 200, JSON.stringify(earned));
      assert.equal(earned.data.ledger.length, 2);
      const commission = moduleId === "barber" ? 50 : 31.25;
      assert.equal(
        earned.data.quote.commission,
        commission,
        "Split receipts never duplicate a fixed per-order commission",
      );
      const cash = {
        clientEventId: "",
        type: "CASH_OUT",
        amount: 100 + commission,
        occurredAt: new Date().toISOString(),
        description: "Synthetic payroll",
        category: "GAJI",
        recipientOrSource: staffId,
        registerId: shift.data.shift.registerId,
      };
      const payroll = {
        ...s,
        action: "PAY",
        commandId: randomUUID(),
        staffId,
        periodMonth: periodEnd.slice(0, 7),
        periodEnd,
        baseSalary: 100,
        allowance: 0,
        deductions: 0,
        fingerprint: earned.data.quote.fingerprint,
        cash,
      };
      cash.clientEventId = "payroll:" + payroll.commandId;
      const approval = await request(
        "/api/v1/finance/approve",
        {
          ...s,
          action: "CASH_OUT",
          reference: cash.clientEventId,
          reason: cash.description,
          command: cash,
          pin: "5926",
        },
        "manager",
      );
      assert.equal(approval.status, 200, JSON.stringify(approval));
      const approvedPayroll = {
        ...payroll,
        cash: { ...cash, approvalGrant: approval.data.approvalGrant },
      };
      r = await request(laborPath, approvedPayroll, "manager");
      assert.equal(r.status, 200, JSON.stringify(r));
      assert.equal(r.data.netSalary, 100 + commission);
      assert.equal(
        (await request(laborPath, approvedPayroll, "manager")).data.replayed,
        true,
      );
      assert.equal(
        (await request(laborQuery, undefined, "manager")).data.quote.commission,
        0,
      );
      await assert.rejects(
        () =>
          admin.query(
            "UPDATE pos.staff_commissions SET commission_amount=999 WHERE job_id=$1",
            [intake.jobId],
          ),
        /WORKSPACE_LABOR_IMMUTABLE/,
      );
      await assert.rejects(
        () =>
          admin.query(
            "UPDATE pos.staff_payrolls SET net_salary=999 WHERE client_slip_id=$1",
            [payroll.commandId],
          ),
        /WORKSPACE_LABOR_IMMUTABLE/,
      );
      const beforePaid = (
        await admin.query(
          "SELECT net_salary,status FROM pos.staff_payrolls WHERE client_slip_id=$1",
          [payroll.commandId],
        )
      ).rows[0];
      for (const receipt of [first, second]) {
        const refund = {
          clientRefundId: randomUUID(),
          occurredAt: new Date().toISOString(),
          refundMethod: "CASH",
          reason: "Synthetic service return",
          items: [
            {
              clientItemId: line.id,
              quantity: receipt.transactions[0].items[0].quantity,
            },
          ],
        };
        const reference = receipt.transactions[0].clientTxnId;
        const a = await request(
          "/api/v1/finance/approve",
          {
            ...s,
            action: "REFUND",
            reference,
            reason: refund.reason,
            command: refund,
            pin: "5926",
          },
          "manager",
        );
        assert.equal(a.status, 200, JSON.stringify(a));
        const body = {
          ...s,
          clientTxnId: reference,
          refund: { ...refund, approvalGrant: a.data.approvalGrant },
        };
        r = await request("/api/v1/finance/refund", body, "manager");
        assert.equal(r.status, 200, JSON.stringify(r));
        assert.equal(
          (await request("/api/v1/finance/refund", body, "manager")).data.refund
            .replayed,
          true,
        );
      }
      const adjusted = await request(laborQuery, undefined, "manager");
      assert.equal(
        adjusted.data.quote.commission,
        -commission,
        "Refund after payroll is a negative carry-forward, not a rewritten paid slip",
      );
      assert.equal(adjusted.data.ledger.length, 4);
      assert.deepEqual(
        (
          await admin.query(
            "SELECT net_salary,status FROM pos.staff_payrolls WHERE client_slip_id=$1",
            [payroll.commandId],
          )
        ).rows[0],
        beforePaid,
      );
      const refundedJob = (
        await request(
          path + "?" + new URLSearchParams(s),
          undefined,
          "cashierA",
        )
      ).data.jobs.find((j: any) => j.id === intake.jobId);
      assert.equal(refundedJob.paid, false);
      assert.equal(
        refundedJob.remaining[line.id],
        0,
        "Refunds do not silently rebill the original intake",
      );
      // Use only the canonical receipt fields exposed to the operational screen.
      const receipt = refundedJob.receipts.find(
        (r: any) => r.client_txn_id === first.transactions[0].clientTxnId,
      );
      assert.equal(receipt.items[0].id, line.id);
      assert.equal(receipt.items[0].productRef, productRef);
      assert.equal(Number(receipt.items[0].returned), 1);
      const voidCommand = {
        clientTxnId: receipt.client_txn_id,
        operationalJobId: intake.jobId,
        shiftId: receipt.client_shift_id,
        createdAt: new Date(receipt.created_at).toISOString(),
        subtotal: Number(receipt.subtotal),
        discountAmount: Number(receipt.discount_amount),
        taxAmount: Number(receipt.tax_amount),
        serviceChargeAmount: Number(receipt.service_charge_amount),
        totalAmount: Number(receipt.total_amount),
        paymentMethod: receipt.payment_method,
        paymentStatus: "CANCELLED",
        voidReason: "Synthetic full refund then void",
        voidedAt: new Date().toISOString(),
        items: receipt.items.map((l: any) => ({
          clientItemId: l.id,
          productRef: l.productRef,
          productName: l.name,
          unitPrice: Number(l.unitPrice),
          unitCost: 0,
          quantity: Number(l.quantity),
          totalPrice: Number(l.unitPrice) * Number(l.quantity),
        })),
      };
      const va = await request(
        "/api/v1/finance/approve",
        {
          ...s,
          action: "VOID",
          reference: voidCommand.clientTxnId,
          reason: voidCommand.voidReason,
          command: voidCommand,
          pin: "5926",
        },
        "manager",
      );
      assert.equal(va.status, 200, JSON.stringify(va));
      const voidBatch = {
        ...s,
        sector: sectors[moduleId],
        idempotencyKey: randomUUID(),
        transactions: [
          { ...voidCommand, approvalGrant: va.data.approvalGrant },
        ],
      };
      const vr = await request(
        "/api/v1/sync/transactions",
        voidBatch,
        "manager",
      );
      assert.equal(vr.data.voided, 1, JSON.stringify(vr));
      assert.equal(
        (await request("/api/v1/sync/transactions", voidBatch, "manager")).data
          .replayed,
        true,
      );
      assert.equal(
        (await request(laborQuery, undefined, "manager")).data.quote.commission,
        -commission,
        "Void after full refund must not reverse the same commission twice",
      );
      r = await request(
        path,
        {
          ...s,
          action: "TRANSITION",
          jobId: intake.jobId,
          commandId: randomUUID(),
          baseRevision: revision + 1,
          status: "CANCELLED",
        },
        "manager",
      );
      assert.equal(r.status, 200, JSON.stringify(r));
      if (moduleId === "barber" && peerRequest) {
        const commands = [0, 1].map(() => ({
          ...intake,
          jobId: randomUUID(),
          commandId: randomUUID(),
          scheduledStart: "2030-02-01T10:00:00Z",
          scheduledEnd: "2030-02-01T11:00:00Z",
        }));
        const race = await Promise.all([
          request(path, commands[0], "cashierA"),
          peerRequest(path, commands[1], "cashierA"),
        ]);
        assert.deepEqual(
          race.map((r) => r.status).sort(),
          [200, 409],
          "Independent PostgreSQL connections permit only one overlapping booking",
        );
        const winner = race.findIndex((r) => r.status === 200);
        assert.equal(
          (
            await request(
              path,
              {
                ...s,
                action: "TRANSITION",
                jobId: commands[winner].jobId,
                commandId: randomUUID(),
                baseRevision: 1,
                status: "CANCELLED",
              },
              "manager",
            )
          ).status,
          200,
        );
        result.concurrentIndependentConnections = true;
      }
      // Exercise keyset history beyond the first page through the actual scoped HTTP route.
      const olderIds = [];
      for (const day of [2, 3]) {
        const extra = {
          ...intake,
          commandId: randomUUID(),
          jobId: randomUUID(),
          scheduledStart: `2031-03-0${day}T10:00:00Z`,
          scheduledEnd: `2031-03-0${day}T11:00:00Z`,
        };
        const created = await request(path, extra, "cashierA");
        assert.equal(created.status, 200, JSON.stringify(created));
        olderIds.push(extra.jobId);
        assert.equal(
          (
            await request(
              path,
              {
                ...s,
                action: "TRANSITION",
                commandId: randomUUID(),
                jobId: extra.jobId,
                baseRevision: 1,
                status: "CANCELLED",
              },
              "manager",
            )
          ).status,
          200,
        );
      }
      const seen = new Set<string>();
      let cursor: string | null = null;
      do {
        const page: any = await request(
          path +
            "?" +
            new URLSearchParams({
              ...s,
              limit: "1",
              ...(cursor ? { cursor } : {}),
            }),
          undefined,
          "owner",
        );
        assert.equal(page.status, 200, JSON.stringify(page));
        assert(page.data.jobs.length <= 1);
        for (const j of page.data.jobs) {
          assert(!seen.has(j.id), "Cursor must not repeat rows");
          seen.add(j.id);
        }
        cursor = page.data.nextCursor;
        assert(seen.size < 100, "Pagination must terminate");
      } while (cursor);
      assert(
        [intake.jobId, ...olderIds].every((id) => seen.has(id)),
        "All history remains reachable",
      );
      assert.equal(
        (
          await request(
            path + "?" + new URLSearchParams({ ...s, cursor: "bad" }),
            undefined,
            "owner",
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await request(
            path + "?" + new URLSearchParams({ ...s, limit: "101" }),
            undefined,
            "owner",
          )
        ).status,
        400,
      );
      const effects = (
        await admin.query(
          "SELECT count(*)::int n FROM pos.workspace_job_receipts WHERE job_id=$1",
          [intake.jobId],
        )
      ).rows[0].n;
      assert.equal(effects, 2, "Only authoritative split receipts are linked");
      const snapshots = (
        await admin.query(
          "SELECT ti.workspace_options FROM pos.transaction_items ti JOIN pos.workspace_job_receipts r ON r.transaction_id=ti.transaction_id WHERE r.job_id=$1",
          [intake.jobId],
        )
      ).rows;
      assert(
        snapshots.every(
          (r: any) =>
            r.workspace_options.variant.name === "Large" &&
            r.workspace_options.modifiers[0].optionName === "Care",
        ),
      );
      result[moduleId] = {
        intake: true,
        paginatedHistory: true,
        moduleFields: true,
        canonicalCatalogueOptions: true,
        stages: true,
        authoritativeCollection: true,
        splitBill: true,
        receiptAudit: true,
        idempotency: true,
        scopeDenial: true,
        commissionSnapshots: true,
        splitCommission: true,
        payrollCashApproval: true,
        refundCarryForward: true,
        refundedCancellation: true,
      };
    }
  } finally {
    delete process.env.NEW_HOPE_MODULE_DOMAIN_WORKFLOWS;
  }
  return result;
}
