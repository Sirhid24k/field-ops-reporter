/**
 * Database types for supabase-js, matching supabase/migrations exactly.
 *
 * Written by hand for session 1 because `supabase gen types` needs Docker on this machine.
 * Regenerate with `npm run db:types` (same shape) whenever a migration changes the schema.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      alerts: {
        Row: {
          acknowledged_at: string | null;
          acknowledged_by: string | null;
          created_at: string;
          id: string;
          message: string;
          org_id: string;
          report_id: string | null;
          severity: Database["public"]["Enums"]["alert_severity"];
          status: Database["public"]["Enums"]["alert_status"];
          type: string;
          vehicle_id: string | null;
        };
        Insert: {
          acknowledged_at?: string | null;
          acknowledged_by?: string | null;
          created_at?: string;
          id?: string;
          message: string;
          org_id: string;
          report_id?: string | null;
          severity: Database["public"]["Enums"]["alert_severity"];
          status?: Database["public"]["Enums"]["alert_status"];
          type: string;
          vehicle_id?: string | null;
        };
        Update: {
          acknowledged_at?: string | null;
          acknowledged_by?: string | null;
          created_at?: string;
          id?: string;
          message?: string;
          org_id?: string;
          report_id?: string | null;
          severity?: Database["public"]["Enums"]["alert_severity"];
          status?: Database["public"]["Enums"]["alert_status"];
          type?: string;
          vehicle_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "alerts_acknowledged_by_fkey";
            columns: ["acknowledged_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "alerts_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "alerts_report_id_fkey";
            columns: ["report_id"];
            isOneToOne: false;
            referencedRelation: "reports";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "alerts_vehicle_id_fkey";
            columns: ["vehicle_id"];
            isOneToOne: false;
            referencedRelation: "vehicles";
            referencedColumns: ["id"];
          },
        ];
      };
      clarifications: {
        Row: {
          answer_audio_path: string | null;
          answer_text: string | null;
          answer_transcript: string | null;
          answered_at: string | null;
          created_at: string;
          id: string;
          org_id: string;
          question: string;
          report_id: string;
        };
        Insert: {
          answer_audio_path?: string | null;
          answer_text?: string | null;
          answer_transcript?: string | null;
          answered_at?: string | null;
          created_at?: string;
          id?: string;
          org_id: string;
          question: string;
          report_id: string;
        };
        Update: {
          answer_audio_path?: string | null;
          answer_text?: string | null;
          answer_transcript?: string | null;
          answered_at?: string | null;
          created_at?: string;
          id?: string;
          org_id?: string;
          question?: string;
          report_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "clarifications_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "clarifications_report_id_fkey";
            columns: ["report_id"];
            isOneToOne: false;
            referencedRelation: "reports";
            referencedColumns: ["id"];
          },
        ];
      };
      daily_digests: {
        Row: {
          content_md: string;
          digest_date: string;
          generated_at: string;
          id: string;
          org_id: string;
          stats: Json;
        };
        Insert: {
          content_md: string;
          digest_date: string;
          generated_at?: string;
          id?: string;
          org_id: string;
          stats: Json;
        };
        Update: {
          content_md?: string;
          digest_date?: string;
          generated_at?: string;
          id?: string;
          org_id?: string;
          stats?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "daily_digests_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      invites: {
        Row: {
          code: string;
          created_at: string;
          expires_at: string;
          id: string;
          org_id: string;
          role: Database["public"]["Enums"]["user_role"];
          used_by: string | null;
        };
        Insert: {
          code: string;
          created_at?: string;
          expires_at: string;
          id?: string;
          org_id: string;
          role?: Database["public"]["Enums"]["user_role"];
          used_by?: string | null;
        };
        Update: {
          code?: string;
          created_at?: string;
          expires_at?: string;
          id?: string;
          org_id?: string;
          role?: Database["public"]["Enums"]["user_role"];
          used_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "invites_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invites_used_by_fkey";
            columns: ["used_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      organizations: {
        Row: {
          created_at: string;
          fuel_baseline_km_per_l: number | null;
          id: string;
          name: string;
          report_cutoff_time: string;
          timezone: string;
        };
        Insert: {
          created_at?: string;
          fuel_baseline_km_per_l?: number | null;
          id?: string;
          name: string;
          report_cutoff_time?: string;
          timezone?: string;
        };
        Update: {
          created_at?: string;
          fuel_baseline_km_per_l?: number | null;
          id?: string;
          name?: string;
          report_cutoff_time?: string;
          timezone?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          active: boolean;
          created_at: string;
          full_name: string;
          id: string;
          org_id: string;
          phone: string | null;
          role: Database["public"]["Enums"]["user_role"];
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          full_name: string;
          id: string;
          org_id: string;
          phone?: string | null;
          role?: Database["public"]["Enums"]["user_role"];
        };
        Update: {
          active?: boolean;
          created_at?: string;
          full_name?: string;
          id?: string;
          org_id?: string;
          phone?: string | null;
          role?: Database["public"]["Enums"]["user_role"];
        };
        Relationships: [
          {
            foreignKeyName: "profiles_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      report_edits: {
        Row: {
          created_at: string;
          edited_by: string;
          field: string;
          id: string;
          new_value: string | null;
          old_value: string | null;
          report_id: string;
        };
        Insert: {
          created_at?: string;
          edited_by: string;
          field: string;
          id?: string;
          new_value?: string | null;
          old_value?: string | null;
          report_id: string;
        };
        Update: {
          created_at?: string;
          edited_by?: string;
          field?: string;
          id?: string;
          new_value?: string | null;
          old_value?: string | null;
          report_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "report_edits_edited_by_fkey";
            columns: ["edited_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "report_edits_report_id_fkey";
            columns: ["report_id"];
            isOneToOne: false;
            referencedRelation: "reports";
            referencedColumns: ["id"];
          },
        ];
      };
      reports: {
        Row: {
          audio_duration_s: number | null;
          audio_path: string | null;
          client_uuid: string;
          confidence: Json | null;
          destination: string | null;
          distance_km: number | null;
          error: string | null;
          extracted: Json | null;
          fuel_cost_ngn: number | null;
          fuel_liters: number | null;
          id: string;
          load_tonnage: number | null;
          load_type: string | null;
          odometer_end: number | null;
          odometer_start: number | null;
          org_id: string;
          origin: string | null;
          processed_at: string | null;
          report_date: string;
          requeue_count: number;
          reviewed_at: string | null;
          reviewed_by: string | null;
          source: Database["public"]["Enums"]["report_source"];
          status: Database["public"]["Enums"]["report_status"];
          submitted_at: string;
          status_changed_at: string;
          summary: string | null;
          transcript: string | null;
          transcript_language: string | null;
          trip_status: string | null;
          typed_note: string | null;
          user_id: string;
          validation: Json | null;
          vehicle_id: string;
        };
        Insert: {
          audio_duration_s?: number | null;
          audio_path?: string | null;
          client_uuid: string;
          confidence?: Json | null;
          destination?: string | null;
          error?: string | null;
          extracted?: Json | null;
          fuel_cost_ngn?: number | null;
          fuel_liters?: number | null;
          id?: string;
          load_tonnage?: number | null;
          load_type?: string | null;
          odometer_end?: number | null;
          odometer_start?: number | null;
          org_id: string;
          origin?: string | null;
          processed_at?: string | null;
          report_date: string;
          requeue_count?: number;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          source: Database["public"]["Enums"]["report_source"];
          status?: Database["public"]["Enums"]["report_status"];
          submitted_at?: string;
          status_changed_at?: string;
          summary?: string | null;
          transcript?: string | null;
          transcript_language?: string | null;
          trip_status?: string | null;
          typed_note?: string | null;
          user_id: string;
          validation?: Json | null;
          vehicle_id: string;
        };
        Update: {
          audio_duration_s?: number | null;
          audio_path?: string | null;
          client_uuid?: string;
          confidence?: Json | null;
          destination?: string | null;
          error?: string | null;
          extracted?: Json | null;
          fuel_cost_ngn?: number | null;
          fuel_liters?: number | null;
          id?: string;
          load_tonnage?: number | null;
          load_type?: string | null;
          odometer_end?: number | null;
          odometer_start?: number | null;
          org_id?: string;
          origin?: string | null;
          processed_at?: string | null;
          report_date?: string;
          requeue_count?: number;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          source?: Database["public"]["Enums"]["report_source"];
          status?: Database["public"]["Enums"]["report_status"];
          submitted_at?: string;
          status_changed_at?: string;
          summary?: string | null;
          transcript?: string | null;
          transcript_language?: string | null;
          trip_status?: string | null;
          typed_note?: string | null;
          user_id?: string;
          validation?: Json | null;
          vehicle_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "reports_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reports_reviewed_by_fkey";
            columns: ["reviewed_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reports_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reports_vehicle_id_fkey";
            columns: ["vehicle_id"];
            isOneToOne: false;
            referencedRelation: "vehicles";
            referencedColumns: ["id"];
          },
        ];
      };
      vehicles: {
        Row: {
          active: boolean;
          created_at: string;
          current_odometer: number | null;
          default_driver_id: string | null;
          id: string;
          label: string | null;
          org_id: string;
          plate_number: string;
          vehicle_type: string | null;
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          current_odometer?: number | null;
          default_driver_id?: string | null;
          id?: string;
          label?: string | null;
          org_id: string;
          plate_number: string;
          vehicle_type?: string | null;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          current_odometer?: number | null;
          default_driver_id?: string | null;
          id?: string;
          label?: string | null;
          org_id?: string;
          plate_number?: string;
          vehicle_type?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "vehicles_default_driver_id_fkey";
            columns: ["default_driver_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "vehicles_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      current_org_id: {
        Args: Record<PropertyKey, never>;
        Returns: string;
      };
      current_user_role: {
        Args: Record<PropertyKey, never>;
        Returns: Database["public"]["Enums"]["user_role"];
      };
      is_org_staff: {
        Args: Record<PropertyKey, never>;
        Returns: boolean;
      };
    };
    Enums: {
      alert_severity: "low" | "medium" | "high";
      alert_status: "open" | "acknowledged";
      report_source: "voice" | "text";
      report_status:
        | "queued"
        | "transcribing"
        | "extracting"
        | "validating"
        | "needs_clarification"
        | "ready"
        | "reviewed"
        | "rejected"
        | "failed";
      user_role: "admin" | "supervisor" | "field";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type PublicSchema = Database["public"];

export type Tables<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Row"];
export type TablesInsert<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Update"];
export type Enums<T extends keyof PublicSchema["Enums"]> = PublicSchema["Enums"][T];

export const Constants = {
  public: {
    Enums: {
      alert_severity: ["low", "medium", "high"],
      alert_status: ["open", "acknowledged"],
      report_source: ["voice", "text"],
      report_status: [
        "queued",
        "transcribing",
        "extracting",
        "validating",
        "needs_clarification",
        "ready",
        "reviewed",
        "rejected",
        "failed",
      ],
      user_role: ["admin", "supervisor", "field"],
    },
  },
} as const;
