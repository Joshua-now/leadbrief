import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow, format } from "date-fns";
import { Users, Mail, Phone, Building2, Linkedin, Search, RefreshCw, AlertCircle, MapPin, Globe, Tag, Download, Loader2, X, Calendar, Clock, Eye, ExternalLink, Briefcase } from "lucide-react";
import { useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { exportFile } from "@/lib/export-utils";
import { apiGet } from "@/lib/apiClient";
import type { Contact } from "@shared/schema";

interface ContactWithCompany extends Contact {
  company?: {
    id: string;
    name: string;
    domain: string | null;
    linkedinUrl: string | null;
  } | null;
}

export default function ContactsPage() {
  const [search, setSearch] = useState("");
  const [isExporting, setIsExporting] = useState(false);
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const { toast } = useToast();
  
  const { data: contacts, isLoading, error, refetch } = useQuery<Contact[]>({
    queryKey: ["/api/contacts"],
  });

  const handleContactClick = (contactId: string) => {
    setSelectedContactId(contactId);
  };

  const handleCloseDetail = () => {
    setSelectedContactId(null);
  };

  const handleExport = async (format: 'csv' | 'json') => {
    if (!contacts?.length) {
      toast({ 
        title: "No Data to Export", 
        description: "There are no contacts to export. Import some data first.", 
        variant: "destructive" 
      });
      return;
    }
    
    setIsExporting(true);
    const result = await exportFile({
      endpoint: '/api/contacts/export',
      format,
      filename: `contacts-export.${format}`,
    });
    setIsExporting(false);
    
    if (!result.success) {
      console.error('[Contacts Export] Failed:', result.error);
    }
  };

  const filteredContacts = contacts?.filter((contact) => {
    if (!search) return true;
    const searchLower = search.toLowerCase();
    return (
      contact.email?.toLowerCase().includes(searchLower) ||
      contact.firstName?.toLowerCase().includes(searchLower) ||
      contact.lastName?.toLowerCase().includes(searchLower) ||
      contact.title?.toLowerCase().includes(searchLower) ||
      contact.companyName?.toLowerCase().includes(searchLower) ||
      contact.website?.toLowerCase().includes(searchLower) ||
      contact.city?.toLowerCase().includes(searchLower) ||
      contact.state?.toLowerCase().includes(searchLower) ||
      contact.category?.toLowerCase().includes(searchLower)
    );
  });

  if (isLoading) {
    return (
      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-5xl space-y-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Contacts</h1>
            <p className="text-muted-foreground">View and manage enriched contacts</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <Card key={i}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <Skeleton className="h-10 w-10 rounded-full" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-5 w-32" />
                      <Skeleton className="h-4 w-24" />
                      <Skeleton className="h-4 w-full" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    const isAuthError = error instanceof Error && 
      (error.message.includes('401') || error.message.includes('Unauthorized') || error.message.includes('unauthorized'));
    
    return (
      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-5xl">
          <Card className="border-destructive/50 bg-destructive/5">
            <CardContent className="flex items-center gap-4 py-6">
              <AlertCircle className="h-8 w-8 text-destructive" />
              <div className="flex-1">
                <p className="font-medium">
                  {isAuthError ? "Session expired" : "Failed to load contacts"}
                </p>
                <p className="text-sm text-muted-foreground">
                  {isAuthError 
                    ? "Your session has ended. Please log in again to continue."
                    : (error instanceof Error ? error.message : "Unknown error")}
                </p>
              </div>
              {isAuthError ? (
                <Button variant="default" onClick={() => window.location.href = '/api/login'} data-testid="button-login">
                  Log In
                </Button>
              ) : (
                <Button variant="outline" onClick={() => refetch()} data-testid="button-retry">
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Retry
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto p-6">
      <div className="mx-auto max-w-5xl space-y-6 pb-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Contacts</h1>
            <p className="text-muted-foreground">
              {contacts?.length || 0} contacts in database
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search contacts..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
                data-testid="input-search-contacts"
              />
            </div>
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => handleExport('csv')}
              disabled={isExporting || !contacts?.length}
              data-testid="button-export-contacts"
            >
              {isExporting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              {isExporting ? 'Exporting...' : 'Export CSV'}
            </Button>
            <Button variant="outline" size="icon" onClick={() => refetch()} data-testid="button-refresh">
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {!filteredContacts || filteredContacts.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                <Users className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-medium">
                {search ? "No contacts found" : "No contacts yet"}
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {search
                  ? "Try a different search term"
                  : "Import some data to see contacts here"}
              </p>
              {!search && (
                <Button className="mt-4" asChild>
                  <a href="/" data-testid="link-import">Go to Import</a>
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filteredContacts.map((contact) => (
              <ContactCard 
                key={contact.id} 
                contact={contact} 
                onClick={() => handleContactClick(contact.id)}
              />
            ))}
          </div>
        )}
      </div>

      <ContactDetailModal 
        contactId={selectedContactId} 
        open={!!selectedContactId}
        onClose={handleCloseDetail}
      />
    </div>
  );
}

function ContactCard({ contact, onClick }: { contact: Contact; onClick: () => void }) {
  const initials = `${contact.firstName?.[0] || ""}${contact.lastName?.[0] || ""}`.toUpperCase() || 
                   contact.companyName?.[0]?.toUpperCase() || "?";
  const fullName = [contact.firstName, contact.lastName].filter(Boolean).join(" ") || contact.companyName || "Unknown";
  const location = [contact.city, contact.state].filter(Boolean).join(", ");

  return (
    <Card 
      className="hover-elevate cursor-pointer transition-shadow" 
      onClick={onClick}
      data-testid={`card-contact-${contact.id}`}
    >
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <Avatar className="h-10 w-10">
            <AvatarFallback className="bg-primary/10 text-primary text-sm font-medium">
              {initials}
            </AvatarFallback>
          </Avatar>
          
          <div className="min-w-0 flex-1">
            <h3 className="font-medium truncate" data-testid={`text-contact-name-${contact.id}`}>
              {fullName}
            </h3>
            
            {contact.title && (
              <p className="text-sm text-muted-foreground truncate">
                {contact.title}
              </p>
            )}

            <div className="mt-2 space-y-1">
              {contact.companyName && (
                <div className="flex items-center gap-2 text-sm">
                  <Building2 className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                  <span className="truncate font-medium" data-testid={`text-company-${contact.id}`}>
                    {contact.companyName}
                  </span>
                </div>
              )}

              {contact.website && (
                <div className="flex items-center gap-2 text-sm">
                  <Globe className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                  <a 
                    href={contact.website.startsWith('http') ? contact.website : `https://${contact.website}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="truncate text-primary hover:underline"
                    data-testid={`link-website-${contact.id}`}
                  >
                    {contact.website.replace(/^https?:\/\//, '')}
                  </a>
                </div>
              )}

              {contact.email && (
                <div className="flex items-center gap-2 text-sm">
                  <Mail className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                  <span className="truncate text-muted-foreground">{contact.email}</span>
                </div>
              )}
              
              {contact.phone && (
                <div className="flex items-center gap-2 text-sm">
                  <Phone className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                  <span className="text-muted-foreground">{contact.phone}</span>
                </div>
              )}

              {location && (
                <div className="flex items-center gap-2 text-sm">
                  <MapPin className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                  <span className="text-muted-foreground" data-testid={`text-location-${contact.id}`}>
                    {location}
                  </span>
                </div>
              )}

              {contact.category && (
                <div className="flex items-center gap-2 text-sm">
                  <Tag className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                  <span className="text-muted-foreground truncate">{contact.category}</span>
                </div>
              )}

              {contact.linkedinUrl && (
                <div className="flex items-center gap-2 text-sm">
                  <Linkedin className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                  <a 
                    href={contact.linkedinUrl} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="truncate text-primary hover:underline"
                  >
                    LinkedIn Profile
                  </a>
                </div>
              )}
            </div>

            {contact.dataQualityScore && (
              <div className="mt-2">
                <Badge variant="secondary" className="text-xs">
                  Quality: {Number(contact.dataQualityScore).toFixed(0)}%
                </Badge>
              </div>
            )}

            {contact.createdAt && (
              <p className="mt-2 text-xs text-muted-foreground">
                Added {formatDistanceToNow(new Date(contact.createdAt), { addSuffix: true })}
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ContactDetailModal({ 
  contactId, 
  open, 
  onClose 
}: { 
  contactId: string | null; 
  open: boolean;
  onClose: () => void;
}) {
  const [contact, setContact] = useState<ContactWithCompany | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    if (!open || !contactId) {
      return;
    }

    let cancelled = false;
    
    const fetchContact = async () => {
      setLoading(true);
      setError(null);
      
      try {
        const response = await apiGet(`/api/contacts/${contactId}`);
        
        if (cancelled) return;
        
        if (response.status === 404) {
          setError("Contact not found");
          setContact(null);
          return;
        }
        
        if (!response.ok) {
          const errBody = await response.json().catch(() => ({}));
          setError(errBody.error || "Could not load contact");
          setContact(null);
          return;
        }
        
        const data = await response.json();
        setContact(data);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Could not load contact");
        setContact(null);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    fetchContact();

    return () => {
      cancelled = true;
    };
  }, [open, contactId, retryCount]);

  const handleRetry = () => {
    setRetryCount(prev => prev + 1);
  };

  const handleClose = () => {
    setContact(null);
    setError(null);
    onClose();
  };

  const fullName = contact 
    ? [contact.firstName, contact.lastName].filter(Boolean).join(" ") || contact.companyName || "Unknown Contact"
    : "Contact Details";
  
  const initials = contact 
    ? `${contact.firstName?.[0] || ""}${contact.lastName?.[0] || ""}`.toUpperCase() || contact.companyName?.[0]?.toUpperCase() || "?"
    : "?";

  const location = contact 
    ? [contact.address, contact.city, contact.state].filter(Boolean).join(", ")
    : null;

  const formatValue = (value: unknown) => {
    if (value === null || value === undefined || value === '') return "—";
    return String(value);
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto" data-testid="modal-contact-detail">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            {contact && (
              <Avatar className="h-10 w-10">
                <AvatarFallback className="bg-primary/10 text-primary text-sm font-medium">
                  {initials}
                </AvatarFallback>
              </Avatar>
            )}
            <span data-testid="text-contact-detail-name">{fullName}</span>
          </DialogTitle>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <AlertCircle className="h-8 w-8 text-destructive mb-2" />
            <p className="text-sm text-destructive" data-testid="text-contact-error">{error}</p>
            <Button 
              variant="outline" 
              size="sm" 
              className="mt-4" 
              onClick={handleRetry}
              data-testid="button-retry-contact"
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Retry
            </Button>
          </div>
        )}

        {contact && !loading && !error && (
          <div className="space-y-6">
            {contact.title && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Briefcase className="h-4 w-4" />
                <span>{contact.title}</span>
              </div>
            )}

            <Separator />

            <div className="space-y-4">
              <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Contact Information</h4>
              
              <div className="grid gap-3">
                <DetailRow icon={Mail} label="Email" value={formatValue(contact.email)} testId="email" />
                <DetailRow icon={Phone} label="Phone" value={formatValue(contact.phone)} testId="phone" />
                <DetailRow icon={Linkedin} label="LinkedIn" value={contact.linkedinUrl ? (
                  <a 
                    href={contact.linkedinUrl} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-primary hover:underline flex items-center gap-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    View Profile <ExternalLink className="h-3 w-3" />
                  </a>
                ) : "—"} testId="linkedin" />
              </div>
            </div>

            <Separator />

            <div className="space-y-4">
              <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Business Information</h4>
              
              <div className="grid gap-3">
                <DetailRow icon={Building2} label="Company" value={formatValue(contact.companyName)} testId="company" />
                <DetailRow icon={Globe} label="Website" value={contact.website ? (
                  <a 
                    href={contact.website.startsWith('http') ? contact.website : `https://${contact.website}`}
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-primary hover:underline flex items-center gap-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {contact.website.replace(/^https?:\/\//, '')} <ExternalLink className="h-3 w-3" />
                  </a>
                ) : "—"} testId="website" />
                <DetailRow icon={MapPin} label="Location" value={formatValue(location)} testId="location" />
                <DetailRow icon={Tag} label="Category" value={formatValue(contact.category)} testId="category" />
              </div>
            </div>

            {contact.company && (
              <>
                <Separator />
                <div className="space-y-4">
                  <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Related Company</h4>
                  <div className="grid gap-3">
                    <DetailRow icon={Building2} label="Company Name" value={formatValue(contact.company.name)} testId="related-company" />
                    <DetailRow icon={Globe} label="Domain" value={contact.company.domain ? (
                      <a 
                        href={`https://${contact.company.domain}`}
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-primary hover:underline flex items-center gap-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {contact.company.domain} <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : "—"} testId="related-domain" />
                  </div>
                </div>
              </>
            )}

            {contact.sources && Array.isArray(contact.sources) && contact.sources.length > 0 && (
              <>
                <Separator />
                <div className="space-y-4">
                  <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Sources</h4>
                  <div className="flex flex-wrap gap-2">
                    {contact.sources.map((source, idx) => (
                      <Badge key={idx} variant="secondary" className="text-xs">
                        {String(source)}
                      </Badge>
                    ))}
                  </div>
                </div>
              </>
            )}

            <Separator />

            <div className="space-y-4">
              <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Timestamps</h4>
              <div className="grid gap-3">
                <DetailRow 
                  icon={Calendar} 
                  label="Created" 
                  value={contact.createdAt ? format(new Date(contact.createdAt), 'PPpp') : "—"} 
                  testId="created" 
                />
                <DetailRow 
                  icon={Clock} 
                  label="Last Seen" 
                  value={contact.lastSeenAt ? format(new Date(contact.lastSeenAt), 'PPpp') : "—"} 
                  testId="last-seen" 
                />
              </div>
            </div>

            {contact.dataQualityScore && (
              <>
                <Separator />
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Data Quality Score</span>
                  <Badge variant="secondary">
                    {Number(contact.dataQualityScore).toFixed(0)}%
                  </Badge>
                </div>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DetailRow({ 
  icon: Icon, 
  label, 
  value,
  testId
}: { 
  icon: React.ComponentType<{ className?: string }>; 
  label: string; 
  value: React.ReactNode;
  testId: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm truncate" data-testid={`text-detail-${testId}`}>{value}</p>
      </div>
    </div>
  );
}
