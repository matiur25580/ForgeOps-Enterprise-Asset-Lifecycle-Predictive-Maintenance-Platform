import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, catchError, map, of } from 'rxjs';

import { environment } from '../../environments/environment';

const API_BASE = environment.apiBaseUrl;

@Injectable({ providedIn: 'root' })
export class OperationsApiService {
  private readonly http = inject(HttpClient);
  private accessToken: string | null = null;

  get authenticated(): boolean { return this.accessToken !== null; }

  login(input: { organizationSlug: string; email: string; password: string }): Observable<unknown> {
    return this.http.post<{ data: { accessToken: string } }>(`${API_BASE}/auth/login`, input, { withCredentials: true })
      .pipe(map((response) => { this.accessToken = response.data.accessToken; return response; }));
  }

  register(input: {
    organizationName: string; organizationSlug: string; firstName: string;
    lastName: string; email: string; password: string;
  }): Observable<unknown> {
    return this.http.post<{ data: { accessToken: string } }>(`${API_BASE}/auth/register`, input, { withCredentials: true })
      .pipe(map((response) => { this.accessToken = response.data.accessToken; return response; }));
  }

  ensureSession(): Observable<boolean> {
    if (this.accessToken) return of(true);
    return this.http.post<{ data: { accessToken: string } }>(`${API_BASE}/auth/refresh`, {}, { withCredentials: true }).pipe(
      map((response) => { this.accessToken = response.data.accessToken; return true; }),
      catchError(() => of(false))
    );
  }

  logout(): Observable<void> {
    return this.http.post<void>(`${API_BASE}/auth/logout`, {}, { withCredentials: true }).pipe(
      map(() => { this.accessToken = null; })
    );
  }

  get<T>(path: string): Observable<T> {
    return this.http.get<T>(`${API_BASE}${path}`, { headers: this.headers() });
  }

  post<T>(path: string, body: unknown): Observable<T> {
    return this.http.post<T>(`${API_BASE}${path}`, body, { headers: this.headers() });
  }

  patch<T>(path: string, body: unknown): Observable<T> {
    return this.http.patch<T>(`${API_BASE}${path}`, body, { headers: this.headers() });
  }

  delete<T>(path: string): Observable<T> {
    return this.http.delete<T>(`${API_BASE}${path}`, { headers: this.headers() });
  }

  private headers(): HttpHeaders {
    return new HttpHeaders(this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {});
  }
}
