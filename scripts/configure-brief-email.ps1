param([ValidateSet('Gmail','SMTP','Resend')][string]$Provider='Gmail')
$ErrorActionPreference='Stop'
$briefValues=[System.Collections.Generic.List[string]]::new()
if($Provider -eq 'Resend'){
 $briefFrom=Read-Host 'Remitente verificado (ejemplo Terminal <brief@tu-dominio.com>)'
 $briefCredential=Read-Host 'API key de Resend' -AsSecureString
 $briefSecretName='BRIEF_RESEND_API_KEY'
}else{
 $briefUser=Read-Host 'E-mail del remitente SMTP'
 $briefHost=if($Provider -eq 'Gmail'){'smtp.gmail.com'}else{Read-Host 'Servidor SMTP'}
 $briefFrom=$briefUser
 $briefValues.Add("BRIEF_SMTP_HOST=$briefHost")
 $briefValues.Add('BRIEF_SMTP_PORT=465')
 $briefValues.Add("BRIEF_SMTP_USER=$briefUser")
 $briefCredential=Read-Host 'Contraseña de aplicación SMTP (no tu contraseña normal de Gmail)' -AsSecureString
 $briefSecretName='BRIEF_SMTP_PASS'
}
if($briefFrom -match '[\r\n]' -or $briefFrom.Length -gt 250){throw 'Remitente inválido.'}
$briefPointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($briefCredential)
$briefTemp=[IO.Path]::GetTempFileName()
try{
 $briefPlain=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($briefPointer)
 if($briefPlain -match '[\r\n]'){throw 'Credencial inválida.'}
 $briefValues.Add("BRIEF_FROM=$briefFrom")
 $briefValues.Add("$briefSecretName=$briefPlain")
 [IO.File]::WriteAllText($briefTemp,($briefValues -join "`n")+"`n",[Text.UTF8Encoding]::new($false))
 & supabase secrets set --project-ref zeimhqybhsrmfljrdkwk --env-file $briefTemp
 if($LASTEXITCODE -ne 0){throw 'No se pudo guardar la configuración.'}
 Write-Host 'Remitente configurado. En la terminal, abre BRIEF y pulsa Enviar prueba a mi correo.'
}finally{
 [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($briefPointer)
 $briefPlain=$null
 $briefValues.Clear()
 Remove-Item -LiteralPath $briefTemp -ErrorAction SilentlyContinue
}
