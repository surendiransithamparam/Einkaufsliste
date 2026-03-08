using Microsoft.Data.SqlClient;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Net;
using System.Net.Mail;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddHttpClient();

var connStr = builder.Configuration.GetConnectionString("Default")
    ?? throw new InvalidOperationException("ConnectionStrings:Default ist nicht konfiguriert. Bitte in appsettings.json, Umgebungsvariablen oder User Secrets setzen.");

builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
    .AddCookie(o =>
    {
        o.Cookie.Name = "einkauf_auth";
        o.Cookie.HttpOnly = true;
        o.Cookie.SameSite = SameSiteMode.Strict;
        o.ExpireTimeSpan = TimeSpan.FromDays(30);
        o.SlidingExpiration = true;
        o.Events.OnRedirectToLogin = ctx =>
        {
            ctx.Response.StatusCode = 401;
            return Task.CompletedTask;
        };
    });
builder.Services.AddAuthorization();

var app = builder.Build();

app.UseDefaultFiles();
app.UseStaticFiles();
app.UseAuthentication();
app.UseAuthorization();

// --- Helpers ---

int? GetUserId(HttpContext ctx) =>
    int.TryParse(ctx.User.FindFirstValue(ClaimTypes.NameIdentifier), out var id) ? id : null;

string GenerateCode()
{
    const string chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    var bytes = RandomNumberGenerator.GetBytes(6);
    return new string(bytes.Select(b => chars[b % chars.Length]).ToArray());
}

async Task<int?> GetHaushaltId(int userId, SqlConnection conn)
{
    await using var cmd = new SqlCommand("SELECT HaushaltId FROM Benutzer WHERE Id=@uid", conn);
    cmd.Parameters.AddWithValue("@uid", userId);
    var result = await cmd.ExecuteScalarAsync();
    return result is int hid ? hid : null;
}

async Task<string> GetHaushaltRolle(int userId, SqlConnection conn)
{
    await using var cmd = new SqlCommand("SELECT HaushaltRolle FROM Benutzer WHERE Id=@uid", conn);
    cmd.Parameters.AddWithValue("@uid", userId);
    var result = await cmd.ExecuteScalarAsync();
    return result is string rolle ? rolle : "schreibend";
}

async Task<bool> CanWrite(int userId, SqlConnection conn)
{
    var rolle = await GetHaushaltRolle(userId, conn);
    return rolle != "lesend";
}

string HashPassword(string password)
{
    var salt = RandomNumberGenerator.GetBytes(16);
    var hash = Rfc2898DeriveBytes.Pbkdf2(password, salt, 100_000, HashAlgorithmName.SHA256, 32);
    return $"{Convert.ToBase64String(salt)}.{Convert.ToBase64String(hash)}";
}

bool VerifyPassword(string password, string stored)
{
    var parts = stored.Split('.');
    if (parts.Length != 2) return false;
    var salt = Convert.FromBase64String(parts[0]);
    var expectedHash = Convert.FromBase64String(parts[1]);
    var actualHash = Rfc2898DeriveBytes.Pbkdf2(password, salt, 100_000, HashAlgorithmName.SHA256, 32);
    return CryptographicOperations.FixedTimeEquals(actualHash, expectedHash);
}

// --- Seed Admin & Ensure Tables ---
{
    using var conn = new SqlConnection(connStr);
    conn.Open();

    // Ensure Favorit table exists
    using var ensureCmd = new SqlCommand(@"
        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name='Favorit')
        CREATE TABLE Favorit (
            Id INT IDENTITY(1,1) PRIMARY KEY,
            BenutzerId INT NOT NULL,
            HaushaltId INT NULL,
            Name NVARCHAR(300) NOT NULL,
            Url NVARCHAR(1000) NULL,
            Quelle NVARCHAR(100) NULL,
            EigenGerichtId INT NULL,
            ErstelltAm DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
            FOREIGN KEY (BenutzerId) REFERENCES Benutzer(Id)
        )", conn);
    ensureCmd.ExecuteNonQuery();

    // Ensure HaushaltRolle column on Benutzer (schreibend/lesend)
    using var rolleCol = new SqlCommand(@"
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id=OBJECT_ID('Benutzer') AND name='HaushaltRolle')
        ALTER TABLE Benutzer ADD HaushaltRolle NVARCHAR(20) NOT NULL DEFAULT 'schreibend'", conn);
    rolleCol.ExecuteNonQuery();

    // Ensure ErstelltVon column on Haushalt
    using var erstelltVonCol = new SqlCommand(@"
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id=OBJECT_ID('Haushalt') AND name='ErstelltVon')
        ALTER TABLE Haushalt ADD ErstelltVon INT NULL", conn);
    erstelltVonCol.ExecuteNonQuery();

    var adminPassword = builder.Configuration["AdminPassword"] ?? "";
    using var checkCmd = new SqlCommand("SELECT COUNT(*) FROM Benutzer WHERE Benutzername='Admin'", conn);
    if ((int)checkCmd.ExecuteScalar()! == 0 && adminPassword.Length >= 4)
    {
        using var cmd = new SqlCommand(
            "INSERT INTO Benutzer (Benutzername, PasswordHash, EmailBestaetigt, IsAdmin) VALUES ('Admin', @hash, 1, 1)", conn);
        cmd.Parameters.AddWithValue("@hash", HashPassword(adminPassword));
        cmd.ExecuteNonQuery();
        app.Logger.LogInformation("Admin-Benutzer erstellt");
    }
}

// --- Email Helper ---

async Task SendActivationEmail(string email, string username, string token, HttpContext ctx)
{
    var smtpHost = app.Configuration["Smtp:Host"] ?? "";
    var smtpPort = int.TryParse(app.Configuration["Smtp:Port"], out var p) ? p : 587;
    var smtpUser = app.Configuration["Smtp:User"] ?? "";
    var smtpPass = app.Configuration["Smtp:Password"] ?? "";
    var fromAddr = app.Configuration["Smtp:From"] ?? smtpUser;
    var fromName = app.Configuration["Smtp:FromName"] ?? "Einkaufsliste";

    var baseUrl = $"{ctx.Request.Scheme}://{ctx.Request.Host}";
    var link = $"{baseUrl}/api/auth/aktivieren?token={Uri.EscapeDataString(token)}";

    var body = $@"Hallo {username},

Bitte bestätige deine E-Mail-Adresse, indem du auf folgenden Link klickst:

{link}

Falls du dich nicht registriert hast, kannst du diese E-Mail ignorieren.

Viele Grüsse
Einkaufsliste";

    using var smtp = new SmtpClient(smtpHost, smtpPort)
    {
        Credentials = new NetworkCredential(smtpUser, smtpPass),
        EnableSsl = true
    };
    var msg = new MailMessage(new MailAddress(fromAddr, fromName), new MailAddress(email))
    {
        Subject = "Einkaufsliste – E-Mail bestätigen",
        Body = body
    };
    await smtp.SendMailAsync(msg);
}

// --- Auth Endpoints ---

app.MapPost("/api/auth/register", async (HttpContext ctx) =>
{
    var doc = await JsonDocument.ParseAsync(ctx.Request.Body);
    var root = doc.RootElement;
    var username = root.GetProperty("benutzername").GetString()?.Trim() ?? "";
    var password = root.GetProperty("passwort").GetString() ?? "";
    var email = root.TryGetProperty("email", out var em) ? em.GetString()?.Trim() ?? "" : "";

    if (username.Length < 2) return Results.BadRequest(new { error = "Benutzername muss mindestens 2 Zeichen haben." });
    if (password.Length < 4) return Results.BadRequest(new { error = "Passwort muss mindestens 4 Zeichen haben." });
    if (email.Length < 5 || !email.Contains('@')) return Results.BadRequest(new { error = "Bitte eine gültige E-Mail-Adresse eingeben." });

    await using var conn = new SqlConnection(connStr);
    await conn.OpenAsync();

    await using var checkCmd = new SqlCommand("SELECT COUNT(*) FROM Benutzer WHERE Benutzername=@name", conn);
    checkCmd.Parameters.AddWithValue("@name", username);
    if ((int)await checkCmd.ExecuteScalarAsync()! > 0)
        return Results.Conflict(new { error = "Benutzername ist bereits vergeben." });

    var token = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).Replace("+", "-").Replace("/", "_");

    await using var cmd = new SqlCommand(
        "INSERT INTO Benutzer (Benutzername, PasswordHash, Email, EmailBestaetigt, AktivierungsToken) OUTPUT INSERTED.Id VALUES (@name, @hash, @email, 0, @token)", conn);
    cmd.Parameters.AddWithValue("@name", username);
    cmd.Parameters.AddWithValue("@hash", HashPassword(password));
    cmd.Parameters.AddWithValue("@email", email);
    cmd.Parameters.AddWithValue("@token", token);
    var userId = (int)await cmd.ExecuteScalarAsync()!;

    try
    {
        await SendActivationEmail(email, username, token, ctx);
    }
    catch (Exception ex)
    {
        app.Logger.LogError(ex, "Aktivierungsmail konnte nicht gesendet werden");
        return Results.Ok(new { benutzername = username, mailFehler = true, message = "Konto erstellt, aber Aktivierungsmail konnte nicht gesendet werden. Bitte kontaktiere den Administrator." });
    }

    return Results.Ok(new { benutzername = username, aktivierung = true, message = "Registrierung erfolgreich! Bitte bestätige deine E-Mail-Adresse." });
});

app.MapPost("/api/auth/login", async (HttpContext ctx) =>
{
    var doc = await JsonDocument.ParseAsync(ctx.Request.Body);
    var root = doc.RootElement;
    var username = root.GetProperty("benutzername").GetString()?.Trim() ?? "";
    var password = root.GetProperty("passwort").GetString() ?? "";

    await using var conn = new SqlConnection(connStr);
    await conn.OpenAsync();
    await using var cmd = new SqlCommand("SELECT Id, PasswordHash, EmailBestaetigt FROM Benutzer WHERE Benutzername=@name", conn);
    cmd.Parameters.AddWithValue("@name", username);
    await using var reader = await cmd.ExecuteReaderAsync();

    if (!await reader.ReadAsync())
        return Results.Unauthorized();

    var userId = reader.GetInt32(0);
    var hash = reader.GetString(1);
    var emailBestaetigt = reader.GetBoolean(2);

    if (!VerifyPassword(password, hash))
        return Results.Unauthorized();

    if (!emailBestaetigt)
        return Results.Json(new { error = "E-Mail-Adresse noch nicht bestätigt. Bitte prüfe dein Postfach." }, statusCode: 403);

    var claims = new List<Claim>
    {
        new(ClaimTypes.NameIdentifier, userId.ToString()),
        new(ClaimTypes.Name, username)
    };
    await ctx.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme,
        new ClaimsPrincipal(new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme)));

    return Results.Ok(new { benutzername = username });
});

app.MapGet("/api/auth/aktivieren", async (string token, HttpContext ctx) =>
{
    await using var conn = new SqlConnection(connStr);
    await conn.OpenAsync();
    await using var cmd = new SqlCommand(
        "UPDATE Benutzer SET EmailBestaetigt=1, AktivierungsToken=NULL WHERE AktivierungsToken=@token AND EmailBestaetigt=0", conn);
    cmd.Parameters.AddWithValue("@token", token);
    var rows = await cmd.ExecuteNonQueryAsync();

    var html = rows > 0
        ? "<html><body style='font-family:sans-serif;text-align:center;padding:3rem'><h2 style='color:#22c55e'>&#10003; E-Mail bestätigt!</h2><p>Dein Konto ist jetzt aktiv. Du kannst dich anmelden.</p><a href='/'>Zur Einkaufsliste</a></body></html>"
        : "<html><body style='font-family:sans-serif;text-align:center;padding:3rem'><h2 style='color:#ef4444'>Link ungültig</h2><p>Dieser Aktivierungslink ist ungültig oder wurde bereits verwendet.</p><a href='/'>Zur Einkaufsliste</a></body></html>";
    ctx.Response.ContentType = "text/html; charset=utf-8";
    await ctx.Response.WriteAsync(html);
});

app.MapPost("/api/auth/resend", async (HttpContext ctx) =>
{
    var doc = await JsonDocument.ParseAsync(ctx.Request.Body);
    var root = doc.RootElement;
    var username = root.GetProperty("benutzername").GetString()?.Trim() ?? "";

    await using var conn = new SqlConnection(connStr);
    await conn.OpenAsync();
    await using var cmd = new SqlCommand("SELECT Id, Email, AktivierungsToken, Benutzername FROM Benutzer WHERE Benutzername=@name AND EmailBestaetigt=0", conn);
    cmd.Parameters.AddWithValue("@name", username);
    await using var reader = await cmd.ExecuteReaderAsync();
    if (!await reader.ReadAsync())
        return Results.BadRequest(new { error = "Konto nicht gefunden oder bereits aktiviert." });

    var email = reader.IsDBNull(1) ? "" : reader.GetString(1);
    var token = reader.IsDBNull(2) ? "" : reader.GetString(2);
    var user = reader.GetString(3);
    await reader.CloseAsync();

    if (string.IsNullOrEmpty(email) || string.IsNullOrEmpty(token))
        return Results.BadRequest(new { error = "Keine E-Mail oder Token vorhanden." });

    try
    {
        await SendActivationEmail(email, user, token, ctx);
        return Results.Ok(new { message = "Aktivierungsmail erneut gesendet." });
    }
    catch (Exception ex)
    {
        app.Logger.LogError(ex, "Aktivierungsmail konnte nicht gesendet werden");
        return Results.BadRequest(new { error = "Mail konnte nicht gesendet werden." });
    }
});

app.MapPost("/api/auth/reset-request", async (HttpContext ctx) =>
{
    var doc = await JsonDocument.ParseAsync(ctx.Request.Body);
    var email = doc.RootElement.GetProperty("email").GetString()?.Trim() ?? "";
    if (email.Length < 5 || !email.Contains('@'))
        return Results.BadRequest(new { error = "Bitte eine gültige E-Mail-Adresse eingeben." });

    await using var conn = new SqlConnection(connStr);
    await conn.OpenAsync();
    await using var findCmd = new SqlCommand("SELECT Id, Benutzername FROM Benutzer WHERE Email=@email", conn);
    findCmd.Parameters.AddWithValue("@email", email);
    await using var reader = await findCmd.ExecuteReaderAsync();
    if (!await reader.ReadAsync())
        // Don't reveal if email exists
        return Results.Ok(new { message = "Falls ein Konto mit dieser E-Mail existiert, wurde ein Link zum Zurücksetzen gesendet." });

    var userId = reader.GetInt32(0);
    var username = reader.GetString(1);
    await reader.CloseAsync();

    var token = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).Replace("+", "-").Replace("/", "_");
    await using var updateCmd = new SqlCommand("UPDATE Benutzer SET ResetToken=@token, ResetTokenExpiry=@expiry WHERE Id=@uid", conn);
    updateCmd.Parameters.AddWithValue("@token", token);
    updateCmd.Parameters.AddWithValue("@expiry", DateTime.UtcNow.AddHours(1));
    updateCmd.Parameters.AddWithValue("@uid", userId);
    await updateCmd.ExecuteNonQueryAsync();

    try
    {
        var smtpHost = app.Configuration["Smtp:Host"] ?? "";
        var smtpPort = int.TryParse(app.Configuration["Smtp:Port"], out var p) ? p : 587;
        var smtpUser = app.Configuration["Smtp:User"] ?? "";
        var smtpPass = app.Configuration["Smtp:Password"] ?? "";
        var fromAddr = app.Configuration["Smtp:From"] ?? smtpUser;
        var fromName = app.Configuration["Smtp:FromName"] ?? "Einkaufsliste";

        var baseUrl = $"{ctx.Request.Scheme}://{ctx.Request.Host}";
        var link = $"{baseUrl}/reset.html?token={Uri.EscapeDataString(token)}";

        var body = $@"Hallo {username},

Du hast ein Zurücksetzen deines Passworts angefordert. Klicke auf folgenden Link:

{link}

Der Link ist 1 Stunde gültig.

Falls du dies nicht angefordert hast, kannst du diese E-Mail ignorieren.

Viele Grüsse
Einkaufsliste";

        using var smtp = new SmtpClient(smtpHost, smtpPort)
        {
            Credentials = new NetworkCredential(smtpUser, smtpPass),
            EnableSsl = true
        };
        var msg = new MailMessage(new MailAddress(fromAddr, fromName), new MailAddress(email))
        {
            Subject = "Einkaufsliste – Passwort zurücksetzen",
            Body = body
        };
        await smtp.SendMailAsync(msg);
    }
    catch (Exception ex)
    {
        app.Logger.LogError(ex, "Reset-Mail konnte nicht gesendet werden");
    }

    return Results.Ok(new { message = "Falls ein Konto mit dieser E-Mail existiert, wurde ein Link zum Zurücksetzen gesendet." });
});

app.MapPost("/api/auth/reset", async (HttpContext ctx) =>
{
    var doc = await JsonDocument.ParseAsync(ctx.Request.Body);
    var root = doc.RootElement;
    var token = root.GetProperty("token").GetString()?.Trim() ?? "";
    var password = root.GetProperty("passwort").GetString() ?? "";

    if (password.Length < 4) return Results.BadRequest(new { error = "Passwort muss mindestens 4 Zeichen haben." });

    await using var conn = new SqlConnection(connStr);
    await conn.OpenAsync();
    await using var findCmd = new SqlCommand("SELECT Id FROM Benutzer WHERE ResetToken=@token AND ResetTokenExpiry>@now", conn);
    findCmd.Parameters.AddWithValue("@token", token);
    findCmd.Parameters.AddWithValue("@now", DateTime.UtcNow);
    var result = await findCmd.ExecuteScalarAsync();
    if (result == null) return Results.BadRequest(new { error = "Link ungültig oder abgelaufen." });

    var userId = (int)result;
    await using var updateCmd = new SqlCommand("UPDATE Benutzer SET PasswordHash=@hash, ResetToken=NULL, ResetTokenExpiry=NULL, EmailBestaetigt=1 WHERE Id=@uid", conn);
    updateCmd.Parameters.AddWithValue("@hash", HashPassword(password));
    updateCmd.Parameters.AddWithValue("@uid", userId);
    await updateCmd.ExecuteNonQueryAsync();

    return Results.Ok(new { message = "Passwort wurde zurückgesetzt. Du kannst dich jetzt anmelden." });
});

app.MapPost("/api/auth/logout", async (HttpContext ctx) =>
{
    await ctx.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
    return Results.Ok();
});

app.MapGet("/api/auth/me", async (HttpContext ctx) =>
{
    var userId = GetUserId(ctx);
    if (userId == null) return Results.Unauthorized();
    await using var conn = new SqlConnection(connStr);
    await conn.OpenAsync();
    await using var cmd = new SqlCommand(@"
        SELECT b.Benutzername, h.Id, h.Name, h.Code, b.Email, b.IsAdmin, b.HaushaltRolle, h.ErstelltVon
        FROM Benutzer b LEFT JOIN Haushalt h ON b.HaushaltId=h.Id
        WHERE b.Id=@uid", conn);
    cmd.Parameters.AddWithValue("@uid", userId.Value);
    await using var reader = await cmd.ExecuteReaderAsync();
    if (!await reader.ReadAsync()) return Results.Unauthorized();
    var haushaltRolle = reader.IsDBNull(6) ? "schreibend" : reader.GetString(6);
    var haushaltErstelltVon = reader.IsDBNull(7) ? (int?)null : reader.GetInt32(7);
    var haushalt = reader.IsDBNull(1) ? null : new {
        id = reader.GetInt32(1),
        name = reader.GetString(2),
        code = reader.GetString(3),
        rolle = haushaltRolle,
        isErsteller = haushaltErstelltVon.HasValue && haushaltErstelltVon.Value == userId.Value
    };
    return Results.Ok(new { benutzername = reader.GetString(0), haushalt, email = reader.IsDBNull(4) ? "" : reader.GetString(4), isAdmin = reader.GetBoolean(5) });
}).RequireAuthorization();

app.MapPut("/api/auth/profil", async (HttpContext ctx) =>
{
    var userId = GetUserId(ctx);
    if (userId == null) return Results.Unauthorized();
    var doc = await JsonDocument.ParseAsync(ctx.Request.Body);
    var root = doc.RootElement;
    var email = root.TryGetProperty("email", out var e) ? e.GetString()?.Trim() ?? "" : "";

    await using var conn = new SqlConnection(connStr);
    await conn.OpenAsync();
    await using var cmd = new SqlCommand("UPDATE Benutzer SET Email=@email WHERE Id=@uid", conn);
    cmd.Parameters.AddWithValue("@email", string.IsNullOrEmpty(email) ? DBNull.Value : email);
    cmd.Parameters.AddWithValue("@uid", userId.Value);
    await cmd.ExecuteNonQueryAsync();
    return Results.Ok();
}).RequireAuthorization();

// --- Haushalt Endpoints ---

app.MapPost("/api/haushalt", async (HttpContext ctx) =>
{
    var userId = GetUserId(ctx)!.Value;
    var doc = await JsonDocument.ParseAsync(ctx.Request.Body);
    var name = doc.RootElement.GetProperty("name").GetString()?.Trim() ?? "";
    if (name.Length < 2) return Results.BadRequest(new { error = "Name muss mindestens 2 Zeichen haben." });

    await using var conn = new SqlConnection(connStr);
    await conn.OpenAsync();

    // Check if already in a household
    var existingHid = await GetHaushaltId(userId, conn);
    if (existingHid != null) return Results.BadRequest(new { error = "Du bist bereits in einem Haushalt." });

    var code = GenerateCode();
    await using var cmd = new SqlCommand(
        "INSERT INTO Haushalt (Name, Code, ErstelltVon) OUTPUT INSERTED.Id VALUES (@name, @code, @uid)", conn);
    cmd.Parameters.AddWithValue("@name", name);
    cmd.Parameters.AddWithValue("@code", code);
    cmd.Parameters.AddWithValue("@uid", userId);
    var haushaltId = (int)await cmd.ExecuteScalarAsync()!;

    await using var updateUser = new SqlCommand("UPDATE Benutzer SET HaushaltId=@hid, HaushaltRolle='admin' WHERE Id=@uid", conn);
    updateUser.Parameters.AddWithValue("@hid", haushaltId);
    updateUser.Parameters.AddWithValue("@uid", userId);
    await updateUser.ExecuteNonQueryAsync();

    // Move existing articles to household
    await using var moveCmd = new SqlCommand("UPDATE Artikel SET HaushaltId=@hid WHERE BenutzerId=@uid AND HaushaltId IS NULL", conn);
    moveCmd.Parameters.AddWithValue("@hid", haushaltId);
    moveCmd.Parameters.AddWithValue("@uid", userId);
    await moveCmd.ExecuteNonQueryAsync();

    return Results.Ok(new { id = haushaltId, name, code });
}).RequireAuthorization();

app.MapPost("/api/haushalt/join", async (HttpContext ctx) =>
{
    var userId = GetUserId(ctx)!.Value;
    var doc = await JsonDocument.ParseAsync(ctx.Request.Body);
    var code = doc.RootElement.GetProperty("code").GetString()?.Trim().ToUpper() ?? "";

    await using var conn = new SqlConnection(connStr);
    await conn.OpenAsync();

    var existingHid = await GetHaushaltId(userId, conn);
    if (existingHid != null) return Results.BadRequest(new { error = "Du bist bereits in einem Haushalt. Zuerst verlassen." });

    await using var findCmd = new SqlCommand("SELECT Id, Name FROM Haushalt WHERE Code=@code", conn);
    findCmd.Parameters.AddWithValue("@code", code);
    await using var reader = await findCmd.ExecuteReaderAsync();
    if (!await reader.ReadAsync()) return Results.NotFound(new { error = "Haushalt nicht gefunden." });
    var haushaltId = reader.GetInt32(0);
    var haushaltName = reader.GetString(1);
    await reader.CloseAsync();

    await using var updateUser = new SqlCommand("UPDATE Benutzer SET HaushaltId=@hid, HaushaltRolle='schreibend' WHERE Id=@uid", conn);
    updateUser.Parameters.AddWithValue("@hid", haushaltId);
    updateUser.Parameters.AddWithValue("@uid", userId);
    await updateUser.ExecuteNonQueryAsync();

    // Move existing articles to household
    await using var moveCmd = new SqlCommand("UPDATE Artikel SET HaushaltId=@hid WHERE BenutzerId=@uid AND HaushaltId IS NULL", conn);
    moveCmd.Parameters.AddWithValue("@hid", haushaltId);
    moveCmd.Parameters.AddWithValue("@uid", userId);
    await moveCmd.ExecuteNonQueryAsync();

    return Results.Ok(new { id = haushaltId, name = haushaltName });
}).RequireAuthorization();

app.MapPost("/api/haushalt/leave", async (HttpContext ctx) =>
{
    var userId = GetUserId(ctx)!.Value;
    await using var conn = new SqlConnection(connStr);
    await conn.OpenAsync();

    // Get current household before leaving
    var hid = await GetHaushaltId(userId, conn);

    await using var cmd = new SqlCommand("UPDATE Benutzer SET HaushaltId=NULL, HaushaltRolle='schreibend' WHERE Id=@uid", conn);
    cmd.Parameters.AddWithValue("@uid", userId);
    await cmd.ExecuteNonQueryAsync();

    // Detach user's articles from household
    await using var detach = new SqlCommand("UPDATE Artikel SET HaushaltId=NULL WHERE BenutzerId=@uid", conn);
    detach.Parameters.AddWithValue("@uid", userId);
    await detach.ExecuteNonQueryAsync();

    // Delete household if no members left
    if (hid != null)
    {
        await using var countCmd = new SqlCommand("SELECT COUNT(*) FROM Benutzer WHERE HaushaltId=@hid", conn);
        countCmd.Parameters.AddWithValue("@hid", hid.Value);
        var remaining = (int)await countCmd.ExecuteScalarAsync()!;
        if (remaining == 0)
        {
            await using var delArticles = new SqlCommand("UPDATE Artikel SET HaushaltId=NULL WHERE HaushaltId=@hid", conn);
            delArticles.Parameters.AddWithValue("@hid", hid.Value);
            await delArticles.ExecuteNonQueryAsync();

            await using var delFav = new SqlCommand("DELETE FROM Favorit WHERE HaushaltId=@hid", conn);
            delFav.Parameters.AddWithValue("@hid", hid.Value);
            await delFav.ExecuteNonQueryAsync();

            await using var delHaushalt = new SqlCommand("DELETE FROM Haushalt WHERE Id=@hid", conn);
            delHaushalt.Parameters.AddWithValue("@hid", hid.Value);
            await delHaushalt.ExecuteNonQueryAsync();
        }
    }

    return Results.Ok();
}).RequireAuthorization();

app.MapGet("/api/haushalt/mitglieder", async (HttpContext ctx) =>
{
    var userId = GetUserId(ctx)!.Value;
    await using var conn = new SqlConnection(connStr);
    await conn.OpenAsync();
    var hid = await GetHaushaltId(userId, conn);
    if (hid == null) return Results.Ok(Array.Empty<object>());

    // Get ErstelltVon
    int? erstelltVon = null;
    await using var hvCmd = new SqlCommand("SELECT ErstelltVon FROM Haushalt WHERE Id=@hid", conn);
    hvCmd.Parameters.AddWithValue("@hid", hid.Value);
    var evResult = await hvCmd.ExecuteScalarAsync();
    if (evResult is int ev) erstelltVon = ev;

    var members = new List<object>();
    await using var cmd = new SqlCommand("SELECT Id, Benutzername, HaushaltRolle FROM Benutzer WHERE HaushaltId=@hid", conn);
    cmd.Parameters.AddWithValue("@hid", hid.Value);
    await using var reader = await cmd.ExecuteReaderAsync();
    while (await reader.ReadAsync())
        members.Add(new {
            id = reader.GetInt32(0),
            benutzername = reader.GetString(1),
            rolle = reader.GetString(2),
            isErsteller = erstelltVon.HasValue && reader.GetInt32(0) == erstelltVon.Value
        });
    return Results.Ok(members);
}).RequireAuthorization();

app.MapPut("/api/haushalt/rolle", async (HttpContext ctx) =>
{
    var userId = GetUserId(ctx)!.Value;
    var doc = await JsonDocument.ParseAsync(ctx.Request.Body);
    var root = doc.RootElement;
    var targetUserId = root.GetProperty("userId").GetInt32();
    var rolle = root.GetProperty("rolle").GetString()?.Trim() ?? "";
    if (rolle != "schreibend" && rolle != "lesend")
        return Results.BadRequest(new { error = "Ungültige Rolle." });

    await using var conn = new SqlConnection(connStr);
    await conn.OpenAsync();
    var hid = await GetHaushaltId(userId, conn);
    if (hid == null) return Results.BadRequest(new { error = "Du bist in keinem Haushalt." });

    // Only the creator (admin) can change roles
    await using var checkCmd = new SqlCommand("SELECT ErstelltVon FROM Haushalt WHERE Id=@hid", conn);
    checkCmd.Parameters.AddWithValue("@hid", hid.Value);
    var creator = await checkCmd.ExecuteScalarAsync();
    if (creator is not int creatorId || creatorId != userId)
        return Results.Forbid();

    // Cannot change own role
    if (targetUserId == userId)
        return Results.BadRequest(new { error = "Du kannst deine eigene Rolle nicht ändern." });

    // Ensure target is in same household
    await using var updateCmd = new SqlCommand(
        "UPDATE Benutzer SET HaushaltRolle=@rolle WHERE Id=@tid AND HaushaltId=@hid", conn);
    updateCmd.Parameters.AddWithValue("@rolle", rolle);
    updateCmd.Parameters.AddWithValue("@tid", targetUserId);
    updateCmd.Parameters.AddWithValue("@hid", hid.Value);
    var rows = await updateCmd.ExecuteNonQueryAsync();
    return rows > 0 ? Results.Ok() : Results.NotFound();
}).RequireAuthorization();

// --- Laden Endpoint ---

app.MapGet("/api/laden", async () =>
{
    var laden = new List<object>();
    await using var conn = new SqlConnection(connStr);
    await conn.OpenAsync();
    await using var cmd = new SqlCommand("SELECT Id, Name FROM Laden ORDER BY Sortierung, Name", conn);
    await using var reader = await cmd.ExecuteReaderAsync();
    while (await reader.ReadAsync())
    {
        laden.Add(new { id = reader.GetInt32(0), name = reader.GetString(1) });
    }
    return Results.Ok(laden);
});

// --- Artikel Endpoints (all require auth, filtered by user) ---

app.MapGet("/api/artikel", async (HttpContext ctx) =>
{
    var userId = GetUserId(ctx)!.Value;
    var items = new List<object>();
    await using var conn = new SqlConnection(connStr);
    await conn.OpenAsync();
    var hid = await GetHaushaltId(userId, conn);
    var sql = hid != null
        ? "SELECT a.Id, a.Artikel, a.Menge, a.Einheit, a.Laden, a.Datum, a.Gekauft, a.ErstelltAm, b.Benutzername FROM Artikel a JOIN Benutzer b ON a.BenutzerId=b.Id WHERE a.HaushaltId=@hid ORDER BY a.Id"
        : "SELECT a.Id, a.Artikel, a.Menge, a.Einheit, a.Laden, a.Datum, a.Gekauft, a.ErstelltAm, NULL FROM Artikel a WHERE a.BenutzerId=@uid AND a.HaushaltId IS NULL ORDER BY a.Id";
    await using var cmd = new SqlCommand(sql, conn);
    if (hid != null) cmd.Parameters.AddWithValue("@hid", hid.Value);
    else cmd.Parameters.AddWithValue("@uid", userId);
    await using var reader = await cmd.ExecuteReaderAsync();
    while (await reader.ReadAsync())
    {
        items.Add(new
        {
            id = reader.GetInt32(0),
            artikel = reader.GetString(1),
            menge = reader.GetDecimal(2),
            einheit = reader.GetString(3),
            laden = reader.IsDBNull(4) ? "" : reader.GetString(4),
            datum = reader.IsDBNull(5) ? "" : reader.GetDateTime(5).ToString("yyyy-MM-dd"),
            gekauft = reader.GetBoolean(6),
            erstelltAm = reader.GetDateTime(7).ToString("o"),
            von = reader.IsDBNull(8) ? null : reader.GetString(8)
        });
    }
    return Results.Ok(items);
}).RequireAuthorization();

app.MapPost("/api/artikel", async (HttpContext ctx) =>
{
    var userId = GetUserId(ctx)!.Value;
    var doc = await JsonDocument.ParseAsync(ctx.Request.Body);
    var root = doc.RootElement;

    await using var conn = new SqlConnection(connStr);
    await conn.OpenAsync();
    if (!await CanWrite(userId, conn)) return Results.Forbid();
    var hid = await GetHaushaltId(userId, conn);
    await using var cmd = new SqlCommand(@"
        INSERT INTO Artikel (Artikel, Menge, Einheit, Laden, Datum, BenutzerId, HaushaltId)
        OUTPUT INSERTED.Id, INSERTED.ErstelltAm
        VALUES (@artikel, @menge, @einheit, @laden, @datum, @uid, @hid)", conn);

    cmd.Parameters.AddWithValue("@artikel", root.GetProperty("artikel").GetString()!);
    cmd.Parameters.AddWithValue("@menge", root.GetProperty("menge").GetDecimal());
    cmd.Parameters.AddWithValue("@einheit", root.GetProperty("einheit").GetString()!);
    cmd.Parameters.AddWithValue("@laden", root.TryGetProperty("laden", out var l) && l.GetString() is string s && s != "" ? s : DBNull.Value);
    cmd.Parameters.AddWithValue("@datum", root.TryGetProperty("datum", out var d) && d.GetString() is string ds && ds != "" ? DateTime.Parse(ds) : DBNull.Value);
    cmd.Parameters.AddWithValue("@uid", userId);
    cmd.Parameters.AddWithValue("@hid", hid.HasValue ? hid.Value : DBNull.Value);

    await using var reader = await cmd.ExecuteReaderAsync();
    await reader.ReadAsync();
    return Results.Ok(new { id = reader.GetInt32(0), erstelltAm = reader.GetDateTime(1).ToString("o") });
}).RequireAuthorization();

app.MapPut("/api/artikel/{id:int}", async (int id, HttpContext ctx) =>
{
    var userId = GetUserId(ctx)!.Value;
    var doc = await JsonDocument.ParseAsync(ctx.Request.Body);
    var root = doc.RootElement;

    await using var conn = new SqlConnection(connStr);
    await conn.OpenAsync();
    if (!await CanWrite(userId, conn)) return Results.Forbid();
    var hid = await GetHaushaltId(userId, conn);
    var where = hid != null ? "Id=@id AND HaushaltId=@hid" : "Id=@id AND BenutzerId=@uid";
    await using var cmd = new SqlCommand($@"
        UPDATE Artikel SET Artikel=@artikel, Menge=@menge, Einheit=@einheit, Laden=@laden, Datum=@datum, Gekauft=@gekauft
        WHERE {where}", conn);

    cmd.Parameters.AddWithValue("@id", id);
    if (hid != null) cmd.Parameters.AddWithValue("@hid", hid.Value);
    else cmd.Parameters.AddWithValue("@uid", userId);
    cmd.Parameters.AddWithValue("@artikel", root.GetProperty("artikel").GetString()!);
    cmd.Parameters.AddWithValue("@menge", root.GetProperty("menge").GetDecimal());
    cmd.Parameters.AddWithValue("@einheit", root.GetProperty("einheit").GetString()!);
    cmd.Parameters.AddWithValue("@laden", root.TryGetProperty("laden", out var l) && l.GetString() is string s && s != "" ? s : DBNull.Value);
    cmd.Parameters.AddWithValue("@datum", root.TryGetProperty("datum", out var d) && d.GetString() is string ds && ds != "" ? DateTime.Parse(ds) : DBNull.Value);
    cmd.Parameters.AddWithValue("@gekauft", root.TryGetProperty("gekauft", out var g) && g.GetBoolean());

    var rows = await cmd.ExecuteNonQueryAsync();
    return rows > 0 ? Results.Ok() : Results.NotFound();
}).RequireAuthorization();

app.MapDelete("/api/artikel/{id:int}", async (int id, HttpContext ctx) =>
{
    var userId = GetUserId(ctx)!.Value;
    await using var conn = new SqlConnection(connStr);
    await conn.OpenAsync();
    if (!await CanWrite(userId, conn)) return Results.Forbid();
    var hid = await GetHaushaltId(userId, conn);
    var where = hid != null ? "Id=@id AND HaushaltId=@hid" : "Id=@id AND BenutzerId=@uid";
    await using var cmd = new SqlCommand($"DELETE FROM Artikel WHERE {where}", conn);
    cmd.Parameters.AddWithValue("@id", id);
    if (hid != null) cmd.Parameters.AddWithValue("@hid", hid.Value);
    else cmd.Parameters.AddWithValue("@uid", userId);
    var rows = await cmd.ExecuteNonQueryAsync();
    return rows > 0 ? Results.Ok() : Results.NotFound();
}).RequireAuthorization();

app.MapDelete("/api/artikel/gekauft", async (HttpContext ctx) =>
{
    var userId = GetUserId(ctx)!.Value;
    await using var conn = new SqlConnection(connStr);
    await conn.OpenAsync();
    if (!await CanWrite(userId, conn)) return Results.Forbid();
    var hid = await GetHaushaltId(userId, conn);
    var where = hid != null ? "Gekauft=1 AND HaushaltId=@hid" : "Gekauft=1 AND BenutzerId=@uid";
    await using var cmd = new SqlCommand($"DELETE FROM Artikel WHERE {where}", conn);
    if (hid != null) cmd.Parameters.AddWithValue("@hid", hid.Value);
    else cmd.Parameters.AddWithValue("@uid", userId);
    var rows = await cmd.ExecuteNonQueryAsync();
    return Results.Ok(new { deleted = rows });
}).RequireAuthorization();

// --- Wochenplan Endpoints ---

app.MapGet("/api/wochenplan", async (string woche, HttpContext ctx) =>
{
    var userId = GetUserId(ctx)!.Value;
    await using var conn = new SqlConnection(connStr);
    await conn.OpenAsync();
    var hid = await GetHaushaltId(userId, conn);
    var where = hid != null ? "HaushaltId=@hid" : "BenutzerId=@uid AND HaushaltId IS NULL";
    var sql = $"SELECT Id, Tag, Mahlzeit, Rezept, Erwachsene, Kinder FROM Wochenplan WHERE Woche=@woche AND {where} ORDER BY Tag, Mahlzeit";
    await using var cmd = new SqlCommand(sql, conn);
    cmd.Parameters.AddWithValue("@woche", DateTime.Parse(woche));
    if (hid != null) cmd.Parameters.AddWithValue("@hid", hid.Value);
    else cmd.Parameters.AddWithValue("@uid", userId);
    await using var reader = await cmd.ExecuteReaderAsync();
    var list = new List<object>();
    while (await reader.ReadAsync())
        list.Add(new { id = reader.GetInt32(0), tag = reader.GetInt32(1), mahlzeit = reader.GetString(2), rezept = reader.GetString(3), erwachsene = reader.GetInt32(4), kinder = reader.GetInt32(5) });
    return Results.Ok(list);
}).RequireAuthorization();

app.MapPost("/api/wochenplan", async (HttpContext ctx) =>
{
    var userId = GetUserId(ctx)!.Value;
    var doc = await JsonDocument.ParseAsync(ctx.Request.Body);
    var root = doc.RootElement;
    await using var conn = new SqlConnection(connStr);
    await conn.OpenAsync();
    if (!await CanWrite(userId, conn)) return Results.Forbid();
    var hid = await GetHaushaltId(userId, conn);

    await using var cmd = new SqlCommand(@"
        MERGE Wochenplan AS t
        USING (SELECT @woche AS Woche, @tag AS Tag, @mahlzeit AS Mahlzeit, @uid AS BenutzerId) AS s
        ON t.Woche=s.Woche AND t.Tag=s.Tag AND t.Mahlzeit=s.Mahlzeit AND t.BenutzerId=s.BenutzerId
        WHEN MATCHED THEN UPDATE SET Rezept=@rezept, Erwachsene=@erw, Kinder=@kind
        WHEN NOT MATCHED THEN INSERT (Woche,Tag,Mahlzeit,Rezept,Erwachsene,Kinder,BenutzerId,HaushaltId) VALUES (@woche,@tag,@mahlzeit,@rezept,@erw,@kind,@uid,@hid);
        SELECT SCOPE_IDENTITY();", conn);
    cmd.Parameters.AddWithValue("@woche", DateTime.Parse(root.GetProperty("woche").GetString()!));
    cmd.Parameters.AddWithValue("@tag", root.GetProperty("tag").GetInt32());
    cmd.Parameters.AddWithValue("@mahlzeit", root.GetProperty("mahlzeit").GetString()!);
    cmd.Parameters.AddWithValue("@rezept", root.GetProperty("rezept").GetString()!);
    cmd.Parameters.AddWithValue("@erw", root.TryGetProperty("erwachsene", out var ew) ? ew.GetInt32() : 2);
    cmd.Parameters.AddWithValue("@kind", root.TryGetProperty("kinder", out var ki) ? ki.GetInt32() : 0);
    cmd.Parameters.AddWithValue("@uid", userId);
    cmd.Parameters.AddWithValue("@hid", hid.HasValue ? hid.Value : DBNull.Value);
    await cmd.ExecuteNonQueryAsync();
    return Results.Ok();
}).RequireAuthorization();

app.MapDelete("/api/wochenplan/{id:int}", async (int id, HttpContext ctx) =>
{
    var userId = GetUserId(ctx)!.Value;
    await using var conn = new SqlConnection(connStr);
    await conn.OpenAsync();
    if (!await CanWrite(userId, conn)) return Results.Forbid();
    var hid = await GetHaushaltId(userId, conn);
    var where = hid != null ? "Id=@id AND HaushaltId=@hid" : "Id=@id AND BenutzerId=@uid";
    await using var cmd = new SqlCommand($"DELETE FROM Wochenplan WHERE {where}", conn);
    cmd.Parameters.AddWithValue("@id", id);
    if (hid != null) cmd.Parameters.AddWithValue("@hid", hid.Value);
    else cmd.Parameters.AddWithValue("@uid", userId);
    await cmd.ExecuteNonQueryAsync();
    return Results.Ok();
}).RequireAuthorization();

// --- Admin Endpoints ---

async Task<bool> IsAdmin(int userId, SqlConnection conn)
{
    await using var cmd = new SqlCommand("SELECT IsAdmin FROM Benutzer WHERE Id=@uid", conn);
    cmd.Parameters.AddWithValue("@uid", userId);
    var result = await cmd.ExecuteScalarAsync();
    return result is bool b && b;
}

app.MapGet("/api/admin/benutzer", async (HttpContext ctx) =>
{
    var userId = GetUserId(ctx)!.Value;
    await using var conn = new SqlConnection(connStr);
    await conn.OpenAsync();
    if (!await IsAdmin(userId, conn)) return Results.Forbid();

    var list = new List<object>();
    await using var cmd = new SqlCommand(@"
        SELECT b.Id, b.Benutzername, b.Email, b.EmailBestaetigt, b.IsAdmin, b.ErstelltAm, h.Name AS Haushalt
        FROM Benutzer b LEFT JOIN Haushalt h ON b.HaushaltId=h.Id
        ORDER BY b.Id", conn);
    await using var reader = await cmd.ExecuteReaderAsync();
    while (await reader.ReadAsync())
        list.Add(new {
            id = reader.GetInt32(0),
            benutzername = reader.GetString(1),
            email = reader.IsDBNull(2) ? "" : reader.GetString(2),
            emailBestaetigt = reader.GetBoolean(3),
            isAdmin = reader.GetBoolean(4),
            erstelltAm = reader.GetDateTime(5).ToString("dd.MM.yyyy HH:mm"),
            haushalt = reader.IsDBNull(6) ? "" : reader.GetString(6)
        });
    return Results.Ok(list);
}).RequireAuthorization();

app.MapPut("/api/admin/benutzer/{id:int}", async (int id, HttpContext ctx) =>
{
    var userId = GetUserId(ctx)!.Value;
    var doc = await JsonDocument.ParseAsync(ctx.Request.Body);
    var root = doc.RootElement;

    await using var conn = new SqlConnection(connStr);
    await conn.OpenAsync();
    if (!await IsAdmin(userId, conn)) return Results.Forbid();

    if (root.TryGetProperty("emailBestaetigt", out var eb))
    {
        await using var cmd = new SqlCommand("UPDATE Benutzer SET EmailBestaetigt=@val WHERE Id=@id", conn);
        cmd.Parameters.AddWithValue("@val", eb.GetBoolean());
        cmd.Parameters.AddWithValue("@id", id);
        await cmd.ExecuteNonQueryAsync();
    }
    if (root.TryGetProperty("isAdmin", out var ia))
    {
        await using var cmd = new SqlCommand("UPDATE Benutzer SET IsAdmin=@val WHERE Id=@id", conn);
        cmd.Parameters.AddWithValue("@val", ia.GetBoolean());
        cmd.Parameters.AddWithValue("@id", id);
        await cmd.ExecuteNonQueryAsync();
    }
    if (root.TryGetProperty("passwort", out var pw) && pw.GetString() is string newPw && newPw.Length >= 4)
    {
        await using var cmd = new SqlCommand("UPDATE Benutzer SET PasswordHash=@hash WHERE Id=@id", conn);
        cmd.Parameters.AddWithValue("@hash", HashPassword(newPw));
        cmd.Parameters.AddWithValue("@id", id);
        await cmd.ExecuteNonQueryAsync();
    }
    return Results.Ok();
}).RequireAuthorization();

app.MapDelete("/api/admin/benutzer/{id:int}", async (int id, HttpContext ctx) =>
{
    var userId = GetUserId(ctx)!.Value;
    await using var conn = new SqlConnection(connStr);
    await conn.OpenAsync();
    if (!await IsAdmin(userId, conn)) return Results.Forbid();
    if (id == userId) return Results.BadRequest(new { error = "Du kannst dich nicht selbst löschen." });

    await using var cmd = new SqlCommand("DELETE FROM Benutzer WHERE Id=@id", conn);
    cmd.Parameters.AddWithValue("@id", id);
    await cmd.ExecuteNonQueryAsync();
    return Results.Ok();
}).RequireAuthorization();

// --- Admin Haushalt Endpoints ---

app.MapGet("/api/admin/haushalte", async (HttpContext ctx) =>
{
    var userId = GetUserId(ctx)!.Value;
    await using var conn = new SqlConnection(connStr);
    await conn.OpenAsync();
    if (!await IsAdmin(userId, conn)) return Results.Forbid();

    var list = new List<object>();
    await using var cmd = new SqlCommand(@"
        SELECT h.Id, h.Name, h.Code, h.ErstelltVon, b.Benutzername AS ErstelltVonName,
            (SELECT COUNT(*) FROM Benutzer WHERE HaushaltId=h.Id) AS Mitglieder
        FROM Haushalt h LEFT JOIN Benutzer b ON h.ErstelltVon=b.Id
        ORDER BY h.Id", conn);
    await using var reader = await cmd.ExecuteReaderAsync();
    while (await reader.ReadAsync())
        list.Add(new {
            id = reader.GetInt32(0),
            name = reader.GetString(1),
            code = reader.GetString(2),
            erstelltVon = reader.IsDBNull(4) ? "" : reader.GetString(4),
            mitglieder = reader.GetInt32(5)
        });
    return Results.Ok(list);
}).RequireAuthorization();

app.MapGet("/api/admin/haushalte/{id:int}/mitglieder", async (int id, HttpContext ctx) =>
{
    var userId = GetUserId(ctx)!.Value;
    await using var conn = new SqlConnection(connStr);
    await conn.OpenAsync();
    if (!await IsAdmin(userId, conn)) return Results.Forbid();

    // Get ErstelltVon
    int? erstelltVon = null;
    await using var hvCmd = new SqlCommand("SELECT ErstelltVon FROM Haushalt WHERE Id=@hid", conn);
    hvCmd.Parameters.AddWithValue("@hid", id);
    var evResult = await hvCmd.ExecuteScalarAsync();
    if (evResult is int ev) erstelltVon = ev;

    var members = new List<object>();
    await using var cmd = new SqlCommand("SELECT Id, Benutzername, HaushaltRolle FROM Benutzer WHERE HaushaltId=@hid", conn);
    cmd.Parameters.AddWithValue("@hid", id);
    await using var reader = await cmd.ExecuteReaderAsync();
    while (await reader.ReadAsync())
        members.Add(new {
            id = reader.GetInt32(0),
            benutzername = reader.GetString(1),
            rolle = reader.GetString(2),
            isErsteller = erstelltVon.HasValue && reader.GetInt32(0) == erstelltVon.Value
        });
    return Results.Ok(members);
}).RequireAuthorization();

app.MapPut("/api/admin/haushalte/{id:int}", async (int id, HttpContext ctx) =>
{
    var userId = GetUserId(ctx)!.Value;
    var doc = await JsonDocument.ParseAsync(ctx.Request.Body);
    var root = doc.RootElement;

    await using var conn = new SqlConnection(connStr);
    await conn.OpenAsync();
    if (!await IsAdmin(userId, conn)) return Results.Forbid();

    if (root.TryGetProperty("name", out var nameEl))
    {
        await using var cmd = new SqlCommand("UPDATE Haushalt SET Name=@name WHERE Id=@id", conn);
        cmd.Parameters.AddWithValue("@name", nameEl.GetString()!.Trim());
        cmd.Parameters.AddWithValue("@id", id);
        await cmd.ExecuteNonQueryAsync();
    }
    return Results.Ok();
}).RequireAuthorization();

app.MapPut("/api/admin/haushalte/{hid:int}/mitglieder/{uid:int}", async (int hid, int uid, HttpContext ctx) =>
{
    var userId = GetUserId(ctx)!.Value;
    var doc = await JsonDocument.ParseAsync(ctx.Request.Body);
    var root = doc.RootElement;

    await using var conn = new SqlConnection(connStr);
    await conn.OpenAsync();
    if (!await IsAdmin(userId, conn)) return Results.Forbid();

    if (root.TryGetProperty("rolle", out var rolleEl))
    {
        var rolle = rolleEl.GetString()?.Trim() ?? "";
        if (rolle != "admin" && rolle != "schreibend" && rolle != "lesend")
            return Results.BadRequest(new { error = "Ungültige Rolle." });
        await using var cmd = new SqlCommand("UPDATE Benutzer SET HaushaltRolle=@rolle WHERE Id=@uid AND HaushaltId=@hid", conn);
        cmd.Parameters.AddWithValue("@rolle", rolle);
        cmd.Parameters.AddWithValue("@uid", uid);
        cmd.Parameters.AddWithValue("@hid", hid);
        await cmd.ExecuteNonQueryAsync();
    }
    return Results.Ok();
}).RequireAuthorization();

app.MapDelete("/api/admin/haushalte/{hid:int}/mitglieder/{uid:int}", async (int hid, int uid, HttpContext ctx) =>
{
    var userId = GetUserId(ctx)!.Value;
    await using var conn = new SqlConnection(connStr);
    await conn.OpenAsync();
    if (!await IsAdmin(userId, conn)) return Results.Forbid();

    await using var cmd = new SqlCommand("UPDATE Benutzer SET HaushaltId=NULL, HaushaltRolle='schreibend' WHERE Id=@uid AND HaushaltId=@hid", conn);
    cmd.Parameters.AddWithValue("@uid", uid);
    cmd.Parameters.AddWithValue("@hid", hid);
    await cmd.ExecuteNonQueryAsync();

    // Delete household if no members left
    await using var countCmd = new SqlCommand("SELECT COUNT(*) FROM Benutzer WHERE HaushaltId=@hid2", conn);
    countCmd.Parameters.AddWithValue("@hid2", hid);
    if ((int)await countCmd.ExecuteScalarAsync()! == 0)
    {
        await using var delA = new SqlCommand("UPDATE Artikel SET HaushaltId=NULL WHERE HaushaltId=@h", conn);
        delA.Parameters.AddWithValue("@h", hid);
        await delA.ExecuteNonQueryAsync();
        await using var delF = new SqlCommand("DELETE FROM Favorit WHERE HaushaltId=@h", conn);
        delF.Parameters.AddWithValue("@h", hid);
        await delF.ExecuteNonQueryAsync();
        await using var delH = new SqlCommand("DELETE FROM Haushalt WHERE Id=@h", conn);
        delH.Parameters.AddWithValue("@h", hid);
        await delH.ExecuteNonQueryAsync();
    }

    return Results.Ok();
}).RequireAuthorization();

app.MapDelete("/api/admin/haushalte/{id:int}", async (int id, HttpContext ctx) =>
{
    var userId = GetUserId(ctx)!.Value;
    await using var conn = new SqlConnection(connStr);
    await conn.OpenAsync();
    if (!await IsAdmin(userId, conn)) return Results.Forbid();

    // Remove all members from household first
    await using var removeMembers = new SqlCommand("UPDATE Benutzer SET HaushaltId=NULL, HaushaltRolle='schreibend' WHERE HaushaltId=@hid", conn);
    removeMembers.Parameters.AddWithValue("@hid", id);
    await removeMembers.ExecuteNonQueryAsync();

    // Detach articles
    await using var detachArticles = new SqlCommand("UPDATE Artikel SET HaushaltId=NULL WHERE HaushaltId=@hid", conn);
    detachArticles.Parameters.AddWithValue("@hid", id);
    await detachArticles.ExecuteNonQueryAsync();

    // Delete household
    await using var cmd = new SqlCommand("DELETE FROM Haushalt WHERE Id=@id", conn);
    cmd.Parameters.AddWithValue("@id", id);
    await cmd.ExecuteNonQueryAsync();
    return Results.Ok();
}).RequireAuthorization();

// --- Gerichte (eigene Rezepte) Endpoints ---

app.MapGet("/api/gerichte", async (HttpContext ctx) =>
{
    var userId = GetUserId(ctx)!.Value;
    await using var conn = new SqlConnection(connStr);
    await conn.OpenAsync();
    var hid = await GetHaushaltId(userId, conn);
    var where = hid != null ? "HaushaltId=@hid" : "BenutzerId=@uid AND HaushaltId IS NULL";
    var sql = $"SELECT Id, Name, ErstelltAm FROM Gericht WHERE {where} ORDER BY Name";
    await using var cmd = new SqlCommand(sql, conn);
    if (hid != null) cmd.Parameters.AddWithValue("@hid", hid.Value);
    else cmd.Parameters.AddWithValue("@uid", userId);
    await using var reader = await cmd.ExecuteReaderAsync();
    var list = new List<object>();
    while (await reader.ReadAsync())
        list.Add(new { id = reader.GetInt32(0), name = reader.GetString(1) });
    return Results.Ok(list);
}).RequireAuthorization();

app.MapGet("/api/gerichte/{id:int}", async (int id, HttpContext ctx) =>
{
    var userId = GetUserId(ctx)!.Value;
    await using var conn = new SqlConnection(connStr);
    await conn.OpenAsync();
    var hid = await GetHaushaltId(userId, conn);
    var where = hid != null ? "g.HaushaltId=@hid" : "g.BenutzerId=@uid AND g.HaushaltId IS NULL";
    await using var cmd = new SqlCommand($"SELECT g.Id, g.Name FROM Gericht g WHERE g.Id=@id AND {where}", conn);
    cmd.Parameters.AddWithValue("@id", id);
    if (hid != null) cmd.Parameters.AddWithValue("@hid", hid.Value);
    else cmd.Parameters.AddWithValue("@uid", userId);
    await using var reader = await cmd.ExecuteReaderAsync();
    if (!await reader.ReadAsync()) return Results.NotFound();
    var gericht = new { id = reader.GetInt32(0), name = reader.GetString(1) };
    await reader.CloseAsync();

    var zutaten = new List<object>();
    await using var zCmd = new SqlCommand("SELECT Id, Artikel, Menge, Einheit FROM GerichtZutat WHERE GerichtId=@gid ORDER BY Id", conn);
    zCmd.Parameters.AddWithValue("@gid", id);
    await using var zReader = await zCmd.ExecuteReaderAsync();
    while (await zReader.ReadAsync())
        zutaten.Add(new { id = zReader.GetInt32(0), artikel = zReader.GetString(1), menge = zReader.GetDecimal(2), einheit = zReader.GetString(3) });

    return Results.Ok(new { gericht.id, gericht.name, zutaten });
}).RequireAuthorization();

app.MapPost("/api/gerichte", async (HttpContext ctx) =>
{
    var userId = GetUserId(ctx)!.Value;
    var doc = await JsonDocument.ParseAsync(ctx.Request.Body);
    var root = doc.RootElement;
    var name = root.GetProperty("name").GetString()?.Trim() ?? "";
    if (name.Length < 1) return Results.BadRequest(new { error = "Name ist erforderlich." });

    await using var conn = new SqlConnection(connStr);
    await conn.OpenAsync();
    if (!await CanWrite(userId, conn)) return Results.Forbid();
    var hid = await GetHaushaltId(userId, conn);

    await using var cmd = new SqlCommand(
        "INSERT INTO Gericht (Name, BenutzerId, HaushaltId) OUTPUT INSERTED.Id VALUES (@name, @uid, @hid)", conn);
    cmd.Parameters.AddWithValue("@name", name);
    cmd.Parameters.AddWithValue("@uid", userId);
    cmd.Parameters.AddWithValue("@hid", hid.HasValue ? hid.Value : DBNull.Value);
    var gerichtId = (int)await cmd.ExecuteScalarAsync()!;

    if (root.TryGetProperty("zutaten", out var zutatenArr))
    {
        foreach (var z in zutatenArr.EnumerateArray())
        {
            var artikel = z.GetProperty("artikel").GetString()?.Trim() ?? "";
            if (artikel == "") continue;
            await using var zCmd = new SqlCommand(
                "INSERT INTO GerichtZutat (GerichtId, Artikel, Menge, Einheit) VALUES (@gid, @artikel, @menge, @einheit)", conn);
            zCmd.Parameters.AddWithValue("@gid", gerichtId);
            zCmd.Parameters.AddWithValue("@artikel", artikel);
            zCmd.Parameters.AddWithValue("@menge", z.TryGetProperty("menge", out var m) ? m.GetDecimal() : 1m);
            zCmd.Parameters.AddWithValue("@einheit", z.TryGetProperty("einheit", out var e) ? e.GetString()! : "Stück");
            await zCmd.ExecuteNonQueryAsync();
        }
    }

    return Results.Ok(new { id = gerichtId });
}).RequireAuthorization();

app.MapPut("/api/gerichte/{id:int}", async (int id, HttpContext ctx) =>
{
    var userId = GetUserId(ctx)!.Value;
    var doc = await JsonDocument.ParseAsync(ctx.Request.Body);
    var root = doc.RootElement;

    await using var conn = new SqlConnection(connStr);
    await conn.OpenAsync();
    if (!await CanWrite(userId, conn)) return Results.Forbid();
    var hid = await GetHaushaltId(userId, conn);
    var where = hid != null ? "Id=@id AND HaushaltId=@hid" : "Id=@id AND BenutzerId=@uid";

    // Update name
    if (root.TryGetProperty("name", out var nameEl))
    {
        await using var cmd = new SqlCommand($"UPDATE Gericht SET Name=@name WHERE {where}", conn);
        cmd.Parameters.AddWithValue("@id", id);
        cmd.Parameters.AddWithValue("@name", nameEl.GetString()!.Trim());
        if (hid != null) cmd.Parameters.AddWithValue("@hid", hid.Value);
        else cmd.Parameters.AddWithValue("@uid", userId);
        var rows = await cmd.ExecuteNonQueryAsync();
        if (rows == 0) return Results.NotFound();
    }

    // Replace zutaten
    if (root.TryGetProperty("zutaten", out var zutatenArr))
    {
        await using var delCmd = new SqlCommand("DELETE FROM GerichtZutat WHERE GerichtId=@gid", conn);
        delCmd.Parameters.AddWithValue("@gid", id);
        await delCmd.ExecuteNonQueryAsync();

        foreach (var z in zutatenArr.EnumerateArray())
        {
            var artikel = z.GetProperty("artikel").GetString()?.Trim() ?? "";
            if (artikel == "") continue;
            await using var zCmd = new SqlCommand(
                "INSERT INTO GerichtZutat (GerichtId, Artikel, Menge, Einheit) VALUES (@gid, @artikel, @menge, @einheit)", conn);
            zCmd.Parameters.AddWithValue("@gid", id);
            zCmd.Parameters.AddWithValue("@artikel", artikel);
            zCmd.Parameters.AddWithValue("@menge", z.TryGetProperty("menge", out var m) ? m.GetDecimal() : 1m);
            zCmd.Parameters.AddWithValue("@einheit", z.TryGetProperty("einheit", out var e) ? e.GetString()! : "Stück");
            await zCmd.ExecuteNonQueryAsync();
        }
    }

    return Results.Ok();
}).RequireAuthorization();

app.MapDelete("/api/gerichte/{id:int}", async (int id, HttpContext ctx) =>
{
    var userId = GetUserId(ctx)!.Value;
    await using var conn = new SqlConnection(connStr);
    await conn.OpenAsync();
    if (!await CanWrite(userId, conn)) return Results.Forbid();
    var hid = await GetHaushaltId(userId, conn);
    var where = hid != null ? "Id=@id AND HaushaltId=@hid" : "Id=@id AND BenutzerId=@uid";
    await using var cmd = new SqlCommand($"DELETE FROM Gericht WHERE {where}", conn);
    cmd.Parameters.AddWithValue("@id", id);
    if (hid != null) cmd.Parameters.AddWithValue("@hid", hid.Value);
    else cmd.Parameters.AddWithValue("@uid", userId);
    var rows = await cmd.ExecuteNonQueryAsync();
    return rows > 0 ? Results.Ok() : Results.NotFound();
}).RequireAuthorization();

// --- Rezept Endpoints ---

app.MapGet("/api/rezept/suche", async (string q, IHttpClientFactory httpFactory) =>
{
    var client = httpFactory.CreateClient();
    client.DefaultRequestHeaders.Add("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36");
    client.Timeout = TimeSpan.FromSeconds(8);
    var eq = Uri.EscapeDataString(q);

    // Search all sources in parallel
    var sources = new (string name, string url, Func<string, string, List<object>> parser)[]
    {
        ("Betty Bossi", $"https://www.bettybossi.ch/de/rezepte/?query={eq}&filters=rezepte",
            (html, _) => ParseBettyBossi(html)),
        ("Migusto", $"https://migusto.migros.ch/de/suche?query={eq}",
            (html, _) => ParseJsonLdRecipes(html, "https://migusto.migros.ch")),
        ("Fooby", $"https://fooby.ch/de/suche?query={eq}",
            (html, _) => ParseJsonLdRecipes(html, "https://fooby.ch")),
        ("Chefkoch", $"https://www.chefkoch.de/rs/s0/{eq}/Rezepte.html",
            (html, _) => ParseChefkoch(html)),
        ("Swissmilk", $"https://www.swissmilk.ch/de/rezepte-kochideen/?search={eq}",
            (html, _) => ParseJsonLdRecipes(html, "https://www.swissmilk.ch")),
        ("GuteKüche", $"https://www.gutekueche.ch/search?search={eq}",
            (html, _) => ParseGuteKueche(html)),
        ("Veg Recipes of India", $"https://www.vegrecipesofindia.com/?s={eq}",
            (html, _) => ParseGenericRecipeLinks(html, "https://www.vegrecipesofindia.com", "Veg Recipes of India")),
        ("Indian Healthy Recipes", $"https://www.indianhealthyrecipes.com/?s={eq}",
            (html, _) => ParseGenericRecipeLinks(html, "https://www.indianhealthyrecipes.com", "Indian Healthy Recipes")),
        ("Cook with Pranji", $"https://cookwithpranji.com/?s={eq}",
            (html, _) => ParseGenericRecipeLinks(html, "https://cookwithpranji.com", "Cook with Pranji")),
        ("Padhuskitchen", $"https://www.padhuskitchen.com/?s={eq}",
            (html, _) => ParseGenericRecipeLinks(html, "https://www.padhuskitchen.com", "Padhuskitchen")),
        ("Hebbars Kitchen", $"https://hebbarskitchen.com/?s={eq}",
            (html, _) => ParseGenericRecipeLinks(html, "https://hebbarskitchen.com", "Hebbars Kitchen")),
    };

    var allResults = new List<object>();
    var tasks = sources.Select(async s =>
    {
        try
        {
            var html = await client.GetStringAsync(s.url);
            var items = s.parser(html, s.name);
            foreach (var item in items.Take(5))
                lock (allResults) allResults.Add(item);
        }
        catch { }
    });
    await Task.WhenAll(tasks);
    return Results.Ok(allResults);
});

List<object> ParseBettyBossi(string html)
{
    var results = new List<object>();
    var linkPattern = new Regex(@"href=""(/de/rezepte/rezept/[^""]+/)""", RegexOptions.IgnoreCase);
    var seen = new HashSet<string>();
    foreach (Match m in linkPattern.Matches(html))
    {
        var path = m.Groups[1].Value;
        if (!seen.Add(path)) continue;
        var slug = path.Split('/').Where(s => !string.IsNullOrEmpty(s)).LastOrDefault() ?? "";
        var nameParts = slug.Split('-');
        if (nameParts.Length > 1 && nameParts.Last().All(char.IsDigit))
            nameParts = nameParts[..^1];
        var name = string.Join(" ", nameParts).Replace("ae", "ä").Replace("ue", "ü").Replace("oe", "ö");
        name = System.Globalization.CultureInfo.CurrentCulture.TextInfo.ToTitleCase(name);
        results.Add(new { url = "https://www.bettybossi.ch" + path, name, source = "Betty Bossi" });
        if (results.Count >= 5) break;
    }
    return results;
}

List<object> ParseJsonLdRecipes(string html, string baseUrl)
{
    var results = new List<object>();
    var jsonLdPattern = new Regex(@"<script[^>]*type=""application/ld\+json""[^>]*>(.*?)</script>", RegexOptions.Singleline | RegexOptions.IgnoreCase);
    // Also try finding recipe links with titles
    var linkPattern = new Regex(@"href=""((?:/[^""]*?)?/rezept[^""]*?)""[^>]*>", RegexOptions.IgnoreCase);
    var titlePattern = new Regex(@"<(?:h[1-4]|span|a)[^>]*>\s*([^<]{3,80}?)\s*</(?:h[1-4]|span|a)>", RegexOptions.IgnoreCase);

    // Try JSON-LD first for recipe list
    foreach (Match jm in jsonLdPattern.Matches(html))
    {
        try
        {
            var doc = JsonDocument.Parse(jm.Groups[1].Value);
            var root = doc.RootElement;
            // Check for ItemList
            if (root.TryGetProperty("itemListElement", out var items))
            {
                foreach (var item in items.EnumerateArray())
                {
                    var url = item.TryGetProperty("url", out var u) ? u.GetString() : null;
                    var name = item.TryGetProperty("name", out var n) ? n.GetString() : null;
                    if (url != null && name != null)
                    {
                        if (!url.StartsWith("http")) url = baseUrl + url;
                        results.Add(new { url, name, source = new Uri(baseUrl).Host.Replace("www.", "") });
                    }
                    if (results.Count >= 5) return results;
                }
            }
            // Single recipe
            if (root.TryGetProperty("@type", out var type) && type.GetString() == "Recipe")
            {
                var url = root.TryGetProperty("url", out var u) ? u.GetString() : null;
                var name = root.TryGetProperty("name", out var n) ? n.GetString() : null;
                if (url != null && name != null)
                    results.Add(new { url, name, source = new Uri(baseUrl).Host.Replace("www.", "") });
            }
        }
        catch { }
    }

    // Fallback: parse links
    if (results.Count == 0)
    {
        var seen = new HashSet<string>();
        foreach (Match m in linkPattern.Matches(html))
        {
            var path = m.Groups[1].Value;
            if (!seen.Add(path)) continue;
            var fullUrl = path.StartsWith("http") ? path : baseUrl + path;
            var slug = path.Split('/').Where(s => !string.IsNullOrEmpty(s)).LastOrDefault() ?? "";
            var name = slug.Replace("-", " ");
            name = System.Globalization.CultureInfo.CurrentCulture.TextInfo.ToTitleCase(name);
            if (name.Length > 2)
                results.Add(new { url = fullUrl, name, source = new Uri(baseUrl).Host.Replace("www.", "") });
            if (results.Count >= 5) break;
        }
    }
    return results;
}

List<object> ParseChefkoch(string html)
{
    var results = new List<object>();
    var pattern = new Regex(@"href=""(https://www\.chefkoch\.de/rezepte/\d+/[^""]+)""", RegexOptions.IgnoreCase);
    // Title from JSON-LD or link text
    var titlePattern = new Regex(@"<h[23][^>]*>\s*<a[^>]*>\s*([^<]+?)\s*</a>", RegexOptions.IgnoreCase);
    var jsonLdPattern = new Regex(@"<script[^>]*type=""application/ld\+json""[^>]*>(.*?)</script>", RegexOptions.Singleline | RegexOptions.IgnoreCase);

    // Try JSON-LD
    foreach (Match jm in jsonLdPattern.Matches(html))
    {
        try
        {
            var doc = JsonDocument.Parse(jm.Groups[1].Value);
            var root = doc.RootElement;
            if (root.TryGetProperty("itemListElement", out var items))
            {
                foreach (var item in items.EnumerateArray())
                {
                    var itemObj = item.TryGetProperty("item", out var it) ? it : item;
                    var url = itemObj.TryGetProperty("url", out var u) ? u.GetString() : null;
                    var name = itemObj.TryGetProperty("name", out var n) ? n.GetString() : null;
                    if (url != null && name != null)
                        results.Add(new { url, name, source = "Chefkoch" });
                    if (results.Count >= 5) return results;
                }
            }
        }
        catch { }
    }

    // Fallback: links
    if (results.Count == 0)
    {
        var seen = new HashSet<string>();
        foreach (Match m in pattern.Matches(html))
        {
            var url = m.Groups[1].Value;
            if (!seen.Add(url)) continue;
            var slug = url.Split('/').LastOrDefault()?.Replace(".html", "") ?? "";
            var name = slug.Replace("-", " ").Replace("_", " ");
            name = System.Globalization.CultureInfo.CurrentCulture.TextInfo.ToTitleCase(name);
            results.Add(new { url, name, source = "Chefkoch" });
            if (results.Count >= 5) break;
        }
    }
    return results;
}

List<object> ParseGuteKueche(string html)
{
    var results = new List<object>();
    var pattern = new Regex(@"href=""(https://www\.gutekueche\.ch/[^""]*-rezept-\d+)""", RegexOptions.IgnoreCase);
    var seen = new HashSet<string>();
    foreach (Match m in pattern.Matches(html))
    {
        var url = m.Groups[1].Value;
        if (!seen.Add(url)) continue;
        var slug = url.Split('/').LastOrDefault() ?? "";
        slug = Regex.Replace(slug, @"-rezept-\d+$", "");
        var name = slug.Replace("-", " ");
        name = System.Globalization.CultureInfo.CurrentCulture.TextInfo.ToTitleCase(name);
        results.Add(new { url, name, source = "GuteKüche" });
        if (results.Count >= 5) break;
    }
    return results;
}

List<object> ParseGenericRecipeLinks(string html, string baseUrl, string sourceName)
{
    var results = new List<object>();
    var jsonLdPattern = new Regex(@"<script[^>]*type=""application/ld\+json""[^>]*>(.*?)</script>", RegexOptions.Singleline | RegexOptions.IgnoreCase);

    // Try JSON-LD first (ItemList or Recipe arrays)
    foreach (Match jm in jsonLdPattern.Matches(html))
    {
        try
        {
            using var doc = JsonDocument.Parse(jm.Groups[1].Value);
            var root = doc.RootElement;

            // Handle @graph arrays (common in WordPress recipe plugins)
            if (root.TryGetProperty("@graph", out var graph))
            {
                foreach (var node in graph.EnumerateArray())
                {
                    var t = node.TryGetProperty("@type", out var tp) ? tp.ToString() : "";
                    if (t.Contains("Recipe"))
                    {
                        var url = node.TryGetProperty("url", out var u) ? u.GetString() : null;
                        var name = node.TryGetProperty("name", out var n) ? n.GetString() : null;
                        if (url != null && name != null)
                            results.Add(new { url, name, source = sourceName });
                        if (results.Count >= 5) return results;
                    }
                }
                if (results.Count > 0) continue;
            }

            // ItemList
            if (root.TryGetProperty("itemListElement", out var items))
            {
                foreach (var item in items.EnumerateArray())
                {
                    var itemObj = item.TryGetProperty("item", out var it) ? it : item;
                    var url = itemObj.TryGetProperty("url", out var u) ? u.GetString() : null;
                    var name = itemObj.TryGetProperty("name", out var n) ? n.GetString() : null;
                    if (url != null && name != null)
                        results.Add(new { url, name, source = sourceName });
                    if (results.Count >= 5) return results;
                }
                if (results.Count > 0) continue;
            }

            // Single Recipe
            var typeStr = root.TryGetProperty("@type", out var typeEl) ? typeEl.ToString() : "";
            if (typeStr.Contains("Recipe"))
            {
                var url = root.TryGetProperty("url", out var u) ? u.GetString() : null;
                var name = root.TryGetProperty("name", out var n) ? n.GetString() : null;
                if (url != null && name != null)
                    results.Add(new { url, name, source = sourceName });
                continue;
            }

            // Array of objects at root
            if (root.ValueKind == JsonValueKind.Array)
            {
                foreach (var el in root.EnumerateArray())
                {
                    var t = el.TryGetProperty("@type", out var tp) ? tp.ToString() : "";
                    if (t.Contains("Recipe"))
                    {
                        var url = el.TryGetProperty("url", out var u) ? u.GetString() : null;
                        var name = el.TryGetProperty("name", out var n) ? n.GetString() : null;
                        if (url != null && name != null)
                            results.Add(new { url, name, source = sourceName });
                        if (results.Count >= 5) return results;
                    }
                }
            }
        }
        catch (JsonException) { }
    }

    // Fallback: parse <a> tags linking to recipe posts (WordPress blog pattern)
    if (results.Count == 0)
    {
        // Match links with post titles - common WordPress search result patterns
        var linkPattern = new Regex(
            @"<a[^>]+href=""(" + Regex.Escape(baseUrl) + @"/[^""]+)""[^>]*>\s*(?:<[^>]+>)*\s*([^<]{3,80}?)\s*(?:</[^>]+>)*\s*</a>",
            RegexOptions.IgnoreCase);
        var seen = new HashSet<string>();
        foreach (Match m in linkPattern.Matches(html))
        {
            var url = m.Groups[1].Value;
            // Skip common non-recipe links
            string[] skipSegments = ["/category/", "/tag/", "/author/", "/page/", "#", "/feed/",
                "/recipes/", "/recipe-index", "/cooking-recipes", "/useful-tips", "/testimonial",
                "/contact", "/about", "/privacy", "/disclaimer"];
            if (skipSegments.Any(s => url.Contains(s))) continue;
            if (!seen.Add(url)) continue;
            var name = System.Net.WebUtility.HtmlDecode(m.Groups[2].Value).Trim();
            if (name.Length < 3 || name.Length > 80) continue;
            // Skip single-word names (likely navigation) and common nav elements
            if (!name.Contains(" ") && name.Length < 15) continue;
            if (name.StartsWith("Read") || name.StartsWith("Continue") || name == "Home" || name == "Search" ||
                name == "ABOUT" || name == "RECIPE INDEX" || name == "USEFUL TIPS" || name == "TESTIMONIALS") continue;
            results.Add(new { url, name, source = sourceName });
            if (results.Count >= 5) break;
        }
    }

    // Fallback 2: extract from <h2>/<h3> tags containing links (another common WordPress pattern)
    if (results.Count == 0)
    {
        var headingLinkPattern = new Regex(
            @"<h[23][^>]*>\s*<a[^>]+href=""([^""]+)""[^>]*>\s*([^<]{3,80}?)\s*</a>",
            RegexOptions.IgnoreCase);
        var seen = new HashSet<string>();
        foreach (Match m in headingLinkPattern.Matches(html))
        {
            var url = m.Groups[1].Value;
            if (!url.StartsWith("http")) url = baseUrl + url;
            if (!url.StartsWith(baseUrl)) continue;
            if (!seen.Add(url)) continue;
            var name = System.Net.WebUtility.HtmlDecode(m.Groups[2].Value).Trim();
            if (name.Length < 3) continue;
            results.Add(new { url, name, source = sourceName });
            if (results.Count >= 5) break;
        }
    }

    return results;
}

app.MapGet("/api/rezept/zutaten", async (string url, IHttpClientFactory httpFactory) =>
{
    var client = httpFactory.CreateClient();
    client.DefaultRequestHeaders.Add("User-Agent", "Mozilla/5.0");
    var html = await client.GetStringAsync(url);

    var zutaten = new List<object>();

    // Try JSON-LD first
    var jsonLdPattern = new Regex(@"<script[^>]*type=""application/ld\+json""[^>]*>(.*?)</script>", RegexOptions.Singleline | RegexOptions.IgnoreCase);
    foreach (Match jm in jsonLdPattern.Matches(html))
    {
        try
        {
            var doc = JsonDocument.Parse(jm.Groups[1].Value);
            if (doc.RootElement.TryGetProperty("recipeIngredient", out var ingredients))
            {
                foreach (var ing in ingredients.EnumerateArray())
                {
                    var text = ing.GetString()?.Trim();
                    if (string.IsNullOrEmpty(text)) continue;
                    ParseZutat(text, zutaten);
                }
                return Results.Ok(zutaten);
            }
        }
        catch { }
    }

    // Fallback: parse HTML for ingredient patterns
    var ingPattern = new Regex(@"(\d+[\.,]?\d*)\s*(g|kg|ml|dl|l|EL|TL|Stück|Prise|Bund|Packung|Pack\.)?\s+(.+?)(?:<|$)", RegexOptions.IgnoreCase);
    foreach (Match im in ingPattern.Matches(html))
    {
        zutaten.Add(new
        {
            menge = decimal.TryParse(im.Groups[1].Value.Replace(",", "."), System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out var mg) ? mg : 1m,
            einheit = string.IsNullOrEmpty(im.Groups[2].Value) ? "Stück" : im.Groups[2].Value,
            artikel = WebUtility.HtmlDecode(im.Groups[3].Value.Trim())
        });
    }

    return Results.Ok(zutaten);
});

void ParseZutat(string text, List<object> list)
{
    // Pattern: "350 g Teigwaren" or "1 Zwiebel" or "0.75 TL Salz"
    var m = Regex.Match(text, @"^(\d+[\.,/]?\d*)\s*(g|kg|ml|dl|l|EL|TL|Stück|Prise|Bund|Packung|Pack\.|Beutel|Dose|Becher|Scheibe|Scheiben|Blatt|Blätter|Zweiglein)?\s*(.+)$", RegexOptions.IgnoreCase);
    if (m.Success)
    {
        var mengeStr = m.Groups[1].Value.Replace(",", ".");
        if (mengeStr.Contains('/'))
        {
            var frac = mengeStr.Split('/');
            mengeStr = (decimal.Parse(frac[0]) / decimal.Parse(frac[1])).ToString(System.Globalization.CultureInfo.InvariantCulture);
        }
        list.Add(new
        {
            menge = decimal.TryParse(mengeStr, System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out var mg) ? mg : 1m,
            einheit = string.IsNullOrEmpty(m.Groups[2].Value) ? "Stück" : m.Groups[2].Value,
            artikel = m.Groups[3].Value.Trim().TrimEnd(',', '.')
        });
    }
    else
    {
        // Unparseable - add as-is
        list.Add(new { menge = 1m, einheit = "Stück", artikel = text.Trim() });
    }
}

// --- Favoriten Endpoints ---

app.MapGet("/api/favoriten", async (HttpContext ctx) =>
{
    var userId = GetUserId(ctx)!.Value;
    await using var conn = new SqlConnection(connStr);
    await conn.OpenAsync();
    var hid = await GetHaushaltId(userId, conn);
    var where = hid != null ? "HaushaltId=@hid" : "BenutzerId=@uid AND HaushaltId IS NULL";
    await using var cmd = new SqlCommand(
        $"SELECT Id, Name, Url, Quelle, EigenGerichtId FROM Favorit WHERE {where} ORDER BY Name", conn);
    if (hid != null) cmd.Parameters.AddWithValue("@hid", hid.Value);
    else cmd.Parameters.AddWithValue("@uid", userId);
    await using var reader = await cmd.ExecuteReaderAsync();
    var list = new List<object>();
    while (await reader.ReadAsync())
        list.Add(new
        {
            id = reader.GetInt32(0),
            name = reader.GetString(1),
            url = reader.IsDBNull(2) ? null : reader.GetString(2),
            quelle = reader.IsDBNull(3) ? null : reader.GetString(3),
            eigenGerichtId = reader.IsDBNull(4) ? (int?)null : reader.GetInt32(4)
        });
    return Results.Ok(list);
}).RequireAuthorization();

app.MapPost("/api/favoriten", async (HttpContext ctx) =>
{
    var userId = GetUserId(ctx)!.Value;
    var doc = await JsonDocument.ParseAsync(ctx.Request.Body);
    var root = doc.RootElement;
    var name = root.GetProperty("name").GetString()?.Trim() ?? "";
    if (name.Length < 1) return Results.BadRequest(new { error = "Name ist erforderlich." });

    var url = root.TryGetProperty("url", out var u) ? u.GetString()?.Trim() : null;
    var quelle = root.TryGetProperty("quelle", out var q) ? q.GetString()?.Trim() : null;
    int? eigenGerichtId = root.TryGetProperty("eigenGerichtId", out var eid) && eid.ValueKind == JsonValueKind.Number ? eid.GetInt32() : null;

    await using var conn = new SqlConnection(connStr);
    await conn.OpenAsync();
    if (!await CanWrite(userId, conn)) return Results.Forbid();
    var hid = await GetHaushaltId(userId, conn);

    // Check duplicate
    var whereCheck = hid != null ? "HaushaltId=@hid" : "BenutzerId=@uid AND HaushaltId IS NULL";
    var dupSql = url != null
        ? $"SELECT COUNT(*) FROM Favorit WHERE {whereCheck} AND Url=@url"
        : eigenGerichtId != null
            ? $"SELECT COUNT(*) FROM Favorit WHERE {whereCheck} AND EigenGerichtId=@eid"
            : $"SELECT COUNT(*) FROM Favorit WHERE {whereCheck} AND Name=@name AND Url IS NULL AND EigenGerichtId IS NULL";
    await using var dupCmd = new SqlCommand(dupSql, conn);
    if (hid != null) dupCmd.Parameters.AddWithValue("@hid", hid.Value);
    else dupCmd.Parameters.AddWithValue("@uid", userId);
    if (url != null) dupCmd.Parameters.AddWithValue("@url", url);
    if (eigenGerichtId != null) dupCmd.Parameters.AddWithValue("@eid", eigenGerichtId.Value);
    dupCmd.Parameters.AddWithValue("@name", name);
    if ((int)await dupCmd.ExecuteScalarAsync()! > 0)
        return Results.Ok(new { duplicate = true });

    await using var cmd = new SqlCommand(
        "INSERT INTO Favorit (BenutzerId, HaushaltId, Name, Url, Quelle, EigenGerichtId) OUTPUT INSERTED.Id VALUES (@uid, @hid, @name, @url, @quelle, @eid)", conn);
    cmd.Parameters.AddWithValue("@uid", userId);
    cmd.Parameters.AddWithValue("@hid", hid.HasValue ? hid.Value : DBNull.Value);
    cmd.Parameters.AddWithValue("@name", name);
    cmd.Parameters.AddWithValue("@url", (object?)url ?? DBNull.Value);
    cmd.Parameters.AddWithValue("@quelle", (object?)quelle ?? DBNull.Value);
    cmd.Parameters.AddWithValue("@eid", eigenGerichtId.HasValue ? eigenGerichtId.Value : DBNull.Value);
    var id = (int)await cmd.ExecuteScalarAsync()!;
    return Results.Ok(new { id });
}).RequireAuthorization();

app.MapDelete("/api/favoriten/{id:int}", async (int id, HttpContext ctx) =>
{
    var userId = GetUserId(ctx)!.Value;
    await using var conn = new SqlConnection(connStr);
    await conn.OpenAsync();
    if (!await CanWrite(userId, conn)) return Results.Forbid();
    var hid = await GetHaushaltId(userId, conn);
    var where = hid != null ? "Id=@id AND HaushaltId=@hid" : "Id=@id AND BenutzerId=@uid AND HaushaltId IS NULL";
    await using var cmd = new SqlCommand($"DELETE FROM Favorit WHERE {where}", conn);
    cmd.Parameters.AddWithValue("@id", id);
    if (hid != null) cmd.Parameters.AddWithValue("@hid", hid.Value);
    else cmd.Parameters.AddWithValue("@uid", userId);
    var rows = await cmd.ExecuteNonQueryAsync();
    return rows > 0 ? Results.Ok() : Results.NotFound();
}).RequireAuthorization();

app.Run();
