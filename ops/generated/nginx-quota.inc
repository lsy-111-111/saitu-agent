# Generated from ops/config/quotas.conf. Do not edit.
# Quota-Generation-SHA256: b75b6868ff22574769fae0db8e66382ea7ed9fbc0336c8bd56b0241a9fe61bc4
limit_req zone=resume_ai_recommend burst=120 nodelay;
limit_req_status 429;
client_max_body_size 64k;
