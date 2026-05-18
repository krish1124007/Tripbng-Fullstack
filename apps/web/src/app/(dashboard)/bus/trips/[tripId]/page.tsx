'use client';

// /bus/trips/[tripId] — seat-layout + BP/DP picker + submit-approval.
//
// This page wraps three steps in a single screen:
//   1. Pick seats from the live tripDetails layout
//   2. Pick boarding + dropping points
//   3. Submit a bus approval request (employeeId from user context)
//
// LIVE every load: tripDetails is never cached (Law 1).

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock,
  Loader2,
  MapPin,
  ShieldCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import type {
  BusApprovalSubmitResponse,
  BusTripDetailsResponse,
} from '@tripbng/shared';
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from '@/components/ui';
import { SeatLayout } from '@/components/bus/seat-layout';
import { ApiCallError } from '@/lib/api';
import { useApiMutation, useApiQuery } from '@/lib/api-client';

export default function BusTripPage() {
  return (
    <Suspense fallback={<TripSkeleton />}>
      <BusTripView />
    </Suspense>
  );
}

function TripSkeleton(): JSX.Element {
  return (
    <div className="space-y-4">
      <Skeleton className="h-12 w-1/2" />
      <Skeleton className="h-64" />
      <Skeleton className="h-32" />
    </div>
  );
}

function BusTripView(): JSX.Element {
  const router = useRouter();
  const params = useParams<{ tripId: string }>();
  const tripId = decodeURIComponent(params.tripId ?? '');
  const search = useSearchParams();
  const doj = search.get('doj') ?? '';
  const sourceId = Number.parseInt(search.get('source') ?? '0', 10);
  const sourceName = search.get('sourceName') ?? '';
  const destinationId = Number.parseInt(search.get('destination') ?? '0', 10);
  const destinationName = search.get('destinationName') ?? '';
  const operatorId = Number.parseInt(search.get('operatorId') ?? '0', 10);
  const operatorName = search.get('operatorName') ?? '';
  const busType = search.get('busType') ?? '';
  const isAc = search.get('isAc') === 'true';
  const isSleeper = search.get('isSleeper') === 'true';
  const inventoryId = search.get('inventoryId') ?? '';
  const departureAt = search.get('departureAt') ?? '';
  const arrivalAt = search.get('arrivalAt') ?? '';

  // ── Live tripDetails ──
  const trip = useApiQuery<BusTripDetailsResponse>(
    ['bus-trip-details', tripId, doj],
    `/api/v1/bus/trips/${encodeURIComponent(tripId)}`,
    {
      query: { doj },
      enabled: !!tripId && !!doj,
    },
  );
  // useApiQuery's wrapper options omit onError; surface failures via
  // a one-shot toast tied to the query's error state.
  useEffect(() => {
    if (trip.isError) toast.error(trip.error?.message ?? 'Failed to load trip details');
  }, [trip.isError, trip.error]);

  // ── Selection state ──
  const [selectedSeats, setSelectedSeats] = useState<string[]>([]);
  const [boardingPointId, setBoardingPointId] = useState<string>('');
  const [droppingPointId, setDroppingPointId] = useState<string>('');
  const [employeeId, setEmployeeId] = useState<string>('');

  const seatFare = useMemo(() => {
    if (!trip.data || selectedSeats.length === 0) return 0;
    const first = trip.data.seats.find((s) => s.seatName === selectedSeats[0]);
    return first?.fareINR ?? 0;
  }, [trip.data, selectedSeats]);

  const totalFare = seatFare * selectedSeats.length;

  // ── Submit ──
  const submit = useApiMutation<
    Record<string, unknown>,
    BusApprovalSubmitResponse
  >('/api/v1/bus/approvals', 'POST', {
    onSuccess: (data) => {
      const status = data.approval.status;
      if (status === 'approved') {
        toast.success('Auto-approved — proceeding to passenger details');
      } else if (status === 'pending') {
        toast.success('Submitted to manager for approval');
      } else {
        toast.success('Approval recorded');
      }
      router.push(`/bus/approvals?employeeId=${employeeId}`);
    },
    onError: (err) =>
      toast.error(err instanceof ApiCallError ? err.message : 'Submit failed'),
  });

  const onSubmit = (): void => {
    if (selectedSeats.length === 0) {
      toast.error('Pick at least one seat');
      return;
    }
    if (!boardingPointId) {
      toast.error('Pick a boarding point');
      return;
    }
    if (!droppingPointId) {
      toast.error('Pick a dropping point');
      return;
    }
    if (!employeeId) {
      toast.error('Pick an employee');
      return;
    }
    if (!trip.data) return;

    submit.mutate({
      employeeId,
      sourceCityId: sourceId,
      destinationCityId: destinationId,
      doj,
      tripId,
      inventoryId,
      seatNumbers: selectedSeats,
      boardingPointId: Number.parseInt(boardingPointId, 10),
      droppingPointId: Number.parseInt(droppingPointId, 10),
      // Per-pax fare in paise — Law 2: byte-for-byte match with seat layout.
      estimatedFarePaise: Math.round(seatFare * 100),
      operatorName,
      operatorId,
      busType,
      isAc,
      isSleeper,
      departureAt,
      arrivalAt,
    });
  };

  if (trip.isPending) return <TripSkeleton />;
  if (trip.isError || !trip.data) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <EmptyState
            title="Couldn't load this trip"
            description={trip.error?.message ?? 'Please go back and try another trip.'}
          />
          <Button
            variant="secondary"
            size="sm"
            className="mt-4"
            onClick={() => router.back()}
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
        </CardContent>
      </Card>
    );
  }

  const details = trip.data;

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Booking · Buses"
        title={`${operatorName || 'Operator'} · ${sourceName} → ${destinationName}`}
        description={`${formatDoj(doj)} · ${busType}`}
        actions={
          <Button variant="ghost" size="sm" onClick={() => router.back()}>
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        {/* Left: seat layout */}
        <Card>
          <CardContent className="space-y-4 p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-h3 text-ink-1">Pick your seats</h2>
              <Badge variant="brand" className="font-mono">
                LIVE
              </Badge>
            </div>
            <SeatLayout
              seats={details.seats}
              forcedSeats={details.forcedSeats}
              selectedSeats={selectedSeats}
              onToggle={(name) => {
                setSelectedSeats((prev) => {
                  if (prev.includes(name)) return prev.filter((s) => s !== name);
                  return [...prev, name];
                });
              }}
            />
          </CardContent>
        </Card>

        {/* Right: BP/DP + submit */}
        <Card className="self-start">
          <CardContent className="space-y-4 p-4">
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-ink-2">Boarding point</label>
                <Select value={boardingPointId} onValueChange={setBoardingPointId}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Choose pickup" />
                  </SelectTrigger>
                  <SelectContent>
                    {details.boardingPoints.map((bp) => (
                      <SelectItem key={bp.id} value={String(bp.id)}>
                        {formatTime(bp.timeAt)} · {bp.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {boardingPointId ? (
                  <BpDpDetail
                    stop={details.boardingPoints.find(
                      (b) => String(b.id) === boardingPointId,
                    )}
                  />
                ) : null}
              </div>

              <div>
                <label className="block text-xs font-medium text-ink-2">Dropping point</label>
                <Select value={droppingPointId} onValueChange={setDroppingPointId}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Choose drop" />
                  </SelectTrigger>
                  <SelectContent>
                    {details.droppingPoints.map((dp) => (
                      <SelectItem key={dp.id} value={String(dp.id)}>
                        {formatTime(dp.timeAt)} · {dp.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {droppingPointId ? (
                  <BpDpDetail
                    stop={details.droppingPoints.find(
                      (d) => String(d.id) === droppingPointId,
                    )}
                  />
                ) : null}
              </div>

              <div>
                <label className="block text-xs font-medium text-ink-2">
                  Employee (traveller)
                </label>
                <input
                  type="text"
                  value={employeeId}
                  placeholder="Mongo ObjectId — paste from employees list"
                  onChange={(e) => setEmployeeId(e.target.value.trim())}
                  className="mt-1 h-9 w-full rounded-md border bg-surface-1 px-2 font-mono text-xs"
                />
                <p className="mt-1 text-[10px] text-ink-4">
                  Phase-9 polish: replace with an employee picker. Today, paste the id from
                  Settings → Employees.
                </p>
              </div>
            </div>

            <div className="rounded-md border bg-surface-2/40 p-3 space-y-2 text-sm">
              <Row label="Selected seats" value={selectedSeats.join(', ') || '—'} />
              <Row label="Per-pax fare" value={selectedSeats.length > 0 ? `₹${seatFare}` : '—'} />
              <Row label="Total" value={selectedSeats.length > 0 ? `₹${totalFare}` : '—'} bold />
            </div>

            <Button
              onClick={onSubmit}
              loading={submit.isPending}
              disabled={
                selectedSeats.length === 0 ||
                !boardingPointId ||
                !droppingPointId ||
                !employeeId
              }
              className="w-full"
            >
              {!submit.isPending ? (
                <>
                  <ShieldCheck className="h-4 w-4" /> Submit for approval
                </>
              ) : (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Submitting…
                </>
              )}
            </Button>

            <p className="text-[10px] text-ink-4">
              Your manager reviews + approves; booking happens automatically once approved.
              Auto-approves below the policy threshold.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function BpDpDetail({
  stop,
}: {
  stop: BusTripDetailsResponse['boardingPoints'][number] | undefined;
}): JSX.Element | null {
  if (!stop) return null;
  return (
    <div className="mt-1 flex items-start gap-1.5 text-[11px] text-ink-3">
      <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
      <div>
        <p className="text-ink-2">{stop.address || stop.name}</p>
        {stop.landmark ? <p>Landmark: {stop.landmark}</p> : null}
        {stop.contact ? <p>Contact: {stop.contact}</p> : null}
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  bold = false,
}: {
  label: string;
  value: string;
  bold?: boolean;
}): JSX.Element {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-xs text-ink-3">{label}</span>
      <span
        className={
          bold ? 'font-mono text-base font-semibold text-ink-1' : 'font-mono text-sm text-ink-1'
        }
      >
        {value}
      </span>
    </div>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function formatDoj(doj: string): string {
  const d = new Date(`${doj}T00:00:00+05:30`);
  if (Number.isNaN(d.getTime())) return doj;
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    weekday: 'short',
  });
}

// Suppress unused-import warning — Clock used by future polish
// (departure/arrival pills inline). Keeping the import surfaces intent.
void Clock;
void CheckCircle2;
void ArrowRight;
