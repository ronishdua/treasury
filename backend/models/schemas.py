from pydantic import BaseModel


class LabelData(BaseModel):
    brand_name: str | None = None
    product_type: str | None = None
    alcohol_by_volume: str | None = None
    net_contents: str | None = None
    country_of_origin: str | None = None
    government_warning_present: bool | None = None
    government_warning_text: str | None = None
    government_warning_header_all_caps: bool | None = None
    government_warning_header_bold: bool | None = None
    sulfite_declaration_present: bool | None = None
    class_type_designation: str | None = None
    producer_name: str | None = None
    producer_address: str | None = None
    raw_text_extracted: str | None = None


class ApplicationRow(BaseModel):
    """Structured application data from Form 5100.31 for a single label."""
    label_id: str
    brand_name: str | None = None
    class_type: str | None = None
    alcohol_content: str | None = None
    net_contents: str | None = None
    producer_name: str | None = None
    producer_address: str | None = None


class ComplianceIssue(BaseModel):
    field: str
    severity: str  # "critical", "needs_review", "pass"
    message: str
    issue_type: str = "presence"  # "presence" or "comparison"


class ComplianceResult(BaseModel):
    passed: bool
    issues: list[ComplianceIssue] = []


class JobCreateRequest(BaseModel):
    total_files: int
    application_data: list[ApplicationRow] | None = None


class JobCreated(BaseModel):
    job_id: str
    duplicate_label_ids: list[str] = []


class FileInfo(BaseModel):
    file_id: int
    client_index: int
    filename: str


class UploadAck(BaseModel):
    files: list[FileInfo]
