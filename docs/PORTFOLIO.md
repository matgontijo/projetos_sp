# projetos_sp — technical portfolio notes

Source reviewed: `9fce098b8ac1afaf338e1dfc42d3eb91514f7ef6` · 2026-11-04. These notes distinguish implemented behavior from next steps; they do not certify a production deployment.

## Purpose

Project finance analytics with ERP ingestion, calculations, access controls and regression coverage.

**Stack:** Python, FastAPI, SQLAlchemy, Alembic, React, TypeScript.

**AI scope:** Deterministic analytics and integration; no trained ML model.

## Evidence in this repository

- [backend/app/omie/client.py](../backend/app/omie/client.py): ERP client integration.
- [backend/app/services/calculo.py](../backend/app/services/calculo.py): Financial calculation logic.
- [backend/app/services/analises.py](../backend/app/services/analises.py): Business analytics service.
- [backend/tests/test_auth.py](../backend/tests/test_auth.py): Access and authentication regressions.
- [backend/tests/test_calculo.py](../backend/tests/test_calculo.py): Financial calculation regressions.

## Validation

```text
cd backend && python -m pytest -q
```

Use an isolated environment and synthetic data. Never run operational ingestion, scheduled jobs or live provider calls merely to demonstrate the project. Test presence is not the same as a successful test run.

## Known limits and next steps

- No model training, held-out predictive metrics or experiment tracking was found.
- The default tree has many backend tests but no GitHub Actions workflow.
- frontend/tsconfig.app.tsbuildinfo and frontend/tsconfig.node.tsbuildinfo are tracked generated files; removal should be a separately reviewed cleanup.

## Portfolio positioning

Supporting evidence for data engineering, testable business rules and production-oriented application design.

A reproducible AI evaluation should document a synthetic or anonymized dataset, baseline, expected outputs, failure cases, quality metrics, latency and cost. Training and evaluating a predictive model would be separate work; it is not claimed here.
