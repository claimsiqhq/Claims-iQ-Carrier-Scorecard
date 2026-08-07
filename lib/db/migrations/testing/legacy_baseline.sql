--
-- PostgreSQL database dump
--

-- Dumped from database version 16.14 (Debian 16.14-1.pgdg13+1)
-- Dumped by pg_dump version 16.14 (Debian 16.14-1.pgdg13+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: audit_findings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_findings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    audit_id uuid,
    type text,
    severity text,
    title text,
    description text,
    source_document_id uuid,
    metadata jsonb,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: audit_sections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_sections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    audit_id uuid,
    section text,
    score numeric,
    reasoning text,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: audit_structured; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_structured (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    audit_id uuid,
    deferred_items jsonb,
    invoice_adjustments jsonb,
    scope_deviations jsonb,
    unknowns jsonb,
    carrier_questions jsonb,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: audit_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    claim_id uuid,
    audit_id uuid,
    version_number integer,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: audits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    claim_id uuid,
    overall_score numeric,
    technical_score numeric,
    presentation_score numeric,
    risk_level text,
    approval_status text,
    executive_summary text,
    raw_response jsonb,
    vision_analysis jsonb,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: carrier_rulesets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.carrier_rulesets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    carrier_key text NOT NULL,
    display_name text NOT NULL,
    logo_url text,
    active boolean DEFAULT true NOT NULL,
    ruleset jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: claims; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.claims (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    claim_number text NOT NULL,
    insured_name text NOT NULL,
    carrier text,
    job_type text,
    date_of_loss date,
    status text DEFAULT 'pending'::text NOT NULL,
    policy_number text,
    loss_type text,
    property_address text,
    adjuster text,
    total_claim_amount text,
    deductible text,
    summary text,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    claim_id uuid,
    type text,
    file_url text,
    extracted_text text,
    metadata jsonb,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: prompt_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prompt_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    key text NOT NULL,
    value text NOT NULL,
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sessions (
    sid character varying NOT NULL,
    sess jsonb NOT NULL,
    expire timestamp without time zone NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    email character varying NOT NULL,
    password_hash character varying NOT NULL,
    first_name character varying,
    last_name character varying,
    profile_image_url character varying,
    role character varying DEFAULT 'user'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: audit_findings audit_findings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_findings
    ADD CONSTRAINT audit_findings_pkey PRIMARY KEY (id);


--
-- Name: audit_sections audit_sections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_sections
    ADD CONSTRAINT audit_sections_pkey PRIMARY KEY (id);


--
-- Name: audit_structured audit_structured_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_structured
    ADD CONSTRAINT audit_structured_pkey PRIMARY KEY (id);


--
-- Name: audit_versions audit_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_versions
    ADD CONSTRAINT audit_versions_pkey PRIMARY KEY (id);


--
-- Name: audits audits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audits
    ADD CONSTRAINT audits_pkey PRIMARY KEY (id);


--
-- Name: carrier_rulesets carrier_rulesets_carrier_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.carrier_rulesets
    ADD CONSTRAINT carrier_rulesets_carrier_key_unique UNIQUE (carrier_key);


--
-- Name: carrier_rulesets carrier_rulesets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.carrier_rulesets
    ADD CONSTRAINT carrier_rulesets_pkey PRIMARY KEY (id);


--
-- Name: claims claims_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claims
    ADD CONSTRAINT claims_pkey PRIMARY KEY (id);


--
-- Name: documents documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_pkey PRIMARY KEY (id);


--
-- Name: prompt_settings prompt_settings_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prompt_settings
    ADD CONSTRAINT prompt_settings_key_unique UNIQUE (key);


--
-- Name: prompt_settings prompt_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prompt_settings
    ADD CONSTRAINT prompt_settings_pkey PRIMARY KEY (id);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (sid);


--
-- Name: audits uq_audits_claim_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audits
    ADD CONSTRAINT uq_audits_claim_id UNIQUE (claim_id);


--
-- Name: users users_email_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_unique UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: IDX_session_expire; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IDX_session_expire" ON public.sessions USING btree (expire);


--
-- Name: idx_audits_claim_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audits_claim_id ON public.audits USING btree (claim_id);


--
-- Name: idx_claims_claim_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_claims_claim_number ON public.claims USING btree (claim_number);


--
-- Name: idx_documents_claim_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documents_claim_id ON public.documents USING btree (claim_id);


--
-- Name: idx_findings_audit_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_findings_audit_id ON public.audit_findings USING btree (audit_id);


--
-- Name: idx_sections_audit_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sections_audit_id ON public.audit_sections USING btree (audit_id);


--
-- Name: audit_findings audit_findings_audit_id_audits_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_findings
    ADD CONSTRAINT audit_findings_audit_id_audits_id_fk FOREIGN KEY (audit_id) REFERENCES public.audits(id) ON DELETE CASCADE;


--
-- Name: audit_findings audit_findings_source_document_id_documents_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_findings
    ADD CONSTRAINT audit_findings_source_document_id_documents_id_fk FOREIGN KEY (source_document_id) REFERENCES public.documents(id);


--
-- Name: audit_sections audit_sections_audit_id_audits_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_sections
    ADD CONSTRAINT audit_sections_audit_id_audits_id_fk FOREIGN KEY (audit_id) REFERENCES public.audits(id) ON DELETE CASCADE;


--
-- Name: audit_structured audit_structured_audit_id_audits_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_structured
    ADD CONSTRAINT audit_structured_audit_id_audits_id_fk FOREIGN KEY (audit_id) REFERENCES public.audits(id) ON DELETE CASCADE;


--
-- Name: audit_versions audit_versions_audit_id_audits_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_versions
    ADD CONSTRAINT audit_versions_audit_id_audits_id_fk FOREIGN KEY (audit_id) REFERENCES public.audits(id) ON DELETE CASCADE;


--
-- Name: audit_versions audit_versions_claim_id_claims_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_versions
    ADD CONSTRAINT audit_versions_claim_id_claims_id_fk FOREIGN KEY (claim_id) REFERENCES public.claims(id) ON DELETE CASCADE;


--
-- Name: audits audits_claim_id_claims_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audits
    ADD CONSTRAINT audits_claim_id_claims_id_fk FOREIGN KEY (claim_id) REFERENCES public.claims(id) ON DELETE CASCADE;


--
-- Name: documents documents_claim_id_claims_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_claim_id_claims_id_fk FOREIGN KEY (claim_id) REFERENCES public.claims(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

