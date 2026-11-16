# Generated from ops/config/quotas.conf. Do not edit.
# Quota-Generation-SHA256: aeb8b67d13d326164ddaa135cc2d530223c2979d738c04d5ec889a8818839357
limit_req zone=resume_ai_track burst=60 nodelay;
limit_req_status 429;
client_max_body_size 64k;
