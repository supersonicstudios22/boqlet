FROM python:3.12-slim-bookworm
WORKDIR /app/engine
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 \
    OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 \
    IFC_BOQ_PRESETS=/app/presets IFC_BOQ_SCHEMAS=/app/packages/types/schema
COPY engine/pyproject.toml ./
COPY engine/ifc_boq ./ifc_boq
COPY presets /app/presets
COPY packages/types/schema /app/packages/types/schema
RUN pip install --no-cache-dir -e .
USER 10001:10001
EXPOSE 8788
CMD ["uvicorn", "ifc_boq.worker_http:app", "--host", "0.0.0.0", "--port", "8788"]
